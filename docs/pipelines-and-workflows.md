# Pipelines & Workflows

Pipelines let you chain multiple agent tasks into ordered, automated sequences. Each step in a pipeline runs a **workflow template** — a reusable task definition with a model, prompt, and timeout. When one step finishes, the next one starts automatically.

Use pipelines for multi-step processes like: code review chains, client feedback triage, deploy sequences, or any workflow where one task feeds into the next.

---

## Concepts

### Workflow Templates

A **workflow template** is a reusable task definition. It's the atomic unit of work in the pipeline system.

| Field | Description |
|-------|-------------|
| `name` | Display name (e.g., "Fix Code from Client Feedback") |
| `description` | What this template does |
| `model` | LLM model to use (e.g., `anthropic/claude-sonnet-4`) |
| `task_prompt` | The prompt sent to the agent when this step executes |
| `timeout_seconds` | Max execution time for this step |
| `agent_role` | Optional role assignment for the spawned agent |
| `tags` | JSON array of tags for organization |

Templates exist independently of pipelines. You create them once, then reference them from any number of pipelines.

### Pipelines

A **pipeline** is an ordered list of steps, where each step references a workflow template.

| Field | Description |
|-------|-------------|
| `name` | Pipeline name (e.g., "Client Feedback Pipeline") |
| `description` | What this pipeline does end-to-end |
| `steps` | Ordered array of `{ template_id, on_failure }` |

Each step has a **failure strategy**:
- `stop` — If this step fails, skip all remaining steps and mark the run as failed
- `continue` — If this step fails, move to the next step anyway

### Pipeline Runs

A **run** is a single execution of a pipeline. It snapshots the steps at start time and tracks progress through each one.

---

## Quick Start

### 1. Create Workflow Templates

Go to **Orchestration** in the sidebar, then the **Templates** section.

Click **Create Template** and fill in:
- **Name**: "Triage Client Feedback"
- **Model**: `anthropic/claude-sonnet-4`
- **Prompt**: "Read the client feedback and identify which files need to change. Create a task list."
- **Timeout**: 300 seconds

Repeat for each step you need (e.g., "Apply Code Changes", "Run Tests", "Report Progress").

### 2. Create a Pipeline

Switch to the **Pipelines** section.

Click **Create Pipeline**:
- **Name**: "Client Feedback Fix"
- **Steps**: Add your templates in order, set failure strategy for each
- Minimum 2 steps required

### 3. Run the Pipeline

Click the **Run** button on your pipeline. The first step spawns immediately. You'll see:
- A banner at the top showing the active run
- Color-coded step progress (blue = pending, amber = running, green = done, red = failed)
- Action buttons: "Step Done", "Step Failed", "Cancel"

### 4. Advance Steps

After each step completes, click **Step Done** to advance to the next step, or **Step Failed** if it didn't work. The pipeline handles the rest based on your failure strategy.

---

## Step Execution

When a step runs, Conductor spawns an OpenClaw agent session with the template's prompt:

```
[Pipeline: Client Feedback Fix | Step 2] Apply the code changes identified in step 1...
```

The spawn creates a unique ID: `pipeline-{runId}-step-{stepIdx}-{timestamp}`

**What happens on each outcome:**

| Outcome | `on_failure: stop` | `on_failure: continue` |
|---------|--------------------|-----------------------|
| Step succeeds | Next step starts | Next step starts |
| Step fails | Remaining steps skipped, run marked `failed` | Next step starts anyway |
| Last step succeeds | Run marked `completed` | Run marked `completed` |
| Run cancelled | All pending/running steps marked `skipped` | All pending/running steps marked `skipped` |

---

## Run Statuses

| Status | Meaning |
|--------|---------|
| `running` | Pipeline is actively executing steps |
| `completed` | All steps finished (some may have failed if using `continue`) |
| `failed` | A step failed and its strategy was `stop` |
| `cancelled` | Manually cancelled by a user |

## Step Statuses

| Status | Color | Meaning |
|--------|-------|---------|
| `pending` | Blue | Waiting to execute |
| `running` | Amber (pulsing) | Currently executing |
| `completed` | Green | Finished successfully |
| `failed` | Red | Execution failed |
| `skipped` | Gray | Skipped due to prior failure or cancellation |

---

## Designing Good Pipelines

### Keep Steps Focused

Each step should do one thing well. Instead of "Fix the bug and write tests and update docs", split into:
1. "Analyze the issue and identify affected files"
2. "Apply the code fix"
3. "Write or update tests"
4. "Update documentation if needed"

### Use `continue` for Non-Critical Steps

If a step is nice-to-have but not blocking (like updating docs or posting a Slack summary), set its failure strategy to `continue` so the pipeline doesn't stop.

### Use `stop` for Dependencies

If step 3 depends on step 2's output (e.g., "deploy" depends on "tests pass"), use `stop` to prevent broken deployments.

### Write Prompts with Context

Reference the pipeline context in your prompts. The step receives the pipeline name and step number, but your prompt should explain what prior steps did:

> "The previous step identified files that need changes based on client feedback. Now apply those changes to the codebase. Focus on the services page and any related components."

---

## API Reference

All endpoints require authentication. Pipelines and templates require **operator** role to create/modify, **viewer** to read.

### Workflow Templates

**List Templates:**
```bash
curl -s "https://conductor.cottontree.vc/api/workflows" \
  -H "x-api-key: $API_KEY"
```

**Create Template:**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/workflows" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Triage Client Feedback",
    "description": "Analyze client feedback and create a task list of changes needed",
    "model": "anthropic/claude-sonnet-4",
    "task_prompt": "Read the client feedback and identify which files need to change...",
    "timeout_seconds": 300,
    "tags": ["client-feedback", "triage"]
  }'
```

### Pipelines

**List Pipelines:**
```bash
curl -s "https://conductor.cottontree.vc/api/pipelines" \
  -H "x-api-key: $API_KEY"
```

**Create Pipeline:**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/pipelines" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Client Feedback Fix",
    "description": "Triage client feedback, apply code changes, verify, and report",
    "steps": [
      { "template_id": 1, "on_failure": "stop" },
      { "template_id": 2, "on_failure": "stop" },
      { "template_id": 3, "on_failure": "continue" }
    ]
  }'
```

### Pipeline Runs

**Start a Run:**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/pipelines/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "action": "start", "pipeline_id": 1 }'
```

**Advance to Next Step (mark current as done):**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/pipelines/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "action": "advance", "run_id": 1, "success": true }'
```

**Mark Step as Failed:**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/pipelines/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "action": "advance", "run_id": 1, "success": false }'
```

**Cancel a Run:**
```bash
curl -s -X POST "https://conductor.cottontree.vc/api/pipelines/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "action": "cancel", "run_id": 1 }'
```

**View Run History:**
```bash
curl -s "https://conductor.cottontree.vc/api/pipelines/run?pipeline_id=1&limit=10" \
  -H "x-api-key: $API_KEY"
```

---

## Example: Client Feedback Pipeline

A real-world pipeline for handling client change requests on web projects:

**Step 1 — Triage** (`on_failure: stop`)
> "Client feedback for {project}: '{feedback}'. Identify which files in the repo need changes. List the specific code locations and what needs to change. Do NOT make changes yet."

**Step 2 — Apply Changes** (`on_failure: stop`)
> "Apply the changes identified in the triage step. Work in branch `fix/client-feedback-{date}`. Commit with a clear message describing what was changed and why."

**Step 3 — Verify** (`on_failure: stop`)
> "Review the changes made in the previous step. Run any available tests. Check that the build still succeeds. Flag any issues."

**Step 4 — Report** (`on_failure: continue`)
> "Summarize what was done: which files changed, what was added/removed, and the current status. Post this as a task comment for the team to review."

This pattern works for any client project — just adjust the prompts with the specific repo path and feedback details.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Minimum 2 steps" error | Pipeline requires at least 2 steps | Add another workflow template step |
| Step stuck at "running" | Agent spawn timed out or errored | Click "Step Failed" to advance, check spawn logs |
| Pipeline shows 0 templates | No workflow templates created yet | Create templates first in the Templates section |
| Run shows all steps "skipped" | First step failed with `on_failure: stop` | Fix the issue and start a new run |
| Can't create pipeline | Insufficient permissions | Requires `operator` or `admin` role |

---

*Last updated: 2026-03-10*
