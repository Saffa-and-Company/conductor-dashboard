import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import path from 'node:path'
import fs from 'node:fs'

interface PipelineStep {
  template_id: number
  on_failure: 'stop' | 'continue'
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  on_failure?: 'stop' | 'continue'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
  pid: number | null
  log_path: string | null
}

interface PipelineRun {
  id: number
  pipeline_id: number
  status: string
  current_step: number
  steps_snapshot: string
  context: string | null
  task_id: number | null
  auto_advance: number
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}

/** In-memory map of running child PIDs so cancel can kill them. */
const runningProcesses = new Map<string, number>()  // key: `${runId}-${stepIdx}`

/**
 * GET /api/pipelines/run - Get pipeline runs
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1
    const pipelineId = searchParams.get('pipeline_id')
    const runId = searchParams.get('id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 200)

    if (runId) {
      const run = db
        .prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?')
        .get(parseInt(runId), workspaceId) as PipelineRun | undefined
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      return NextResponse.json({ run: { ...run, steps_snapshot: JSON.parse(run.steps_snapshot) } })
    }

    let query = 'SELECT * FROM pipeline_runs WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (pipelineId) {
      query += ' AND pipeline_id = ?'
      params.push(parseInt(pipelineId))
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const runs = db.prepare(query).all(...params) as PipelineRun[]

    // Enrich with pipeline names
    const pipelineIds = [...new Set(runs.map(r => r.pipeline_id))]
    const pipelines = pipelineIds.length > 0
      ? db.prepare(`SELECT id, name FROM workflow_pipelines WHERE workspace_id = ? AND id IN (${pipelineIds.map(() => '?').join(',')})`).all(workspaceId, ...pipelineIds) as Array<{ id: number; name: string }>
      : []
    const nameMap = new Map(pipelines.map(p => [p.id, p.name]))

    const parsed = runs.map(r => ({
      ...r,
      pipeline_name: nameMap.get(r.pipeline_id) || 'Deleted Pipeline',
      steps_snapshot: JSON.parse(r.steps_snapshot),
    }))

    return NextResponse.json({ runs: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/pipelines/run error')
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines/run - Start a pipeline run or advance a running one
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { action, pipeline_id, run_id } = body

    if (action === 'start') {
      return startPipeline(db, pipeline_id, auth.user?.username || 'system', workspaceId, body.context, body.task_id, body.auto_advance)
    } else if (action === 'advance') {
      return advanceRun(db, run_id, body.success ?? true, body.error, workspaceId)
    } else if (action === 'cancel') {
      return cancelRun(db, run_id, workspaceId)
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, advance, cancel' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipelines/run error')
    return NextResponse.json({ error: 'Failed to process pipeline run' }, { status: 500 })
  }
}

/** Resolve the agent id for pipeline spawns (same pattern as cron jobs). */
function getPipelineAgentId(): string {
  return String(
    process.env.MC_PIPELINE_AGENT_ID ||
    process.env.MC_COORDINATOR_AGENT ||
    process.env.MC_CRON_AGENT_ID ||
    'main'
  ).trim() || 'main'
}

/** Get the pipeline logs directory, creating it if needed. */
function getLogsDir(): string {
  const { config } = require('@/lib/config')
  const logsDir = path.join(config.dataDir, 'pipeline-logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
  return logsDir
}

/** Spawn a single pipeline step using `openclaw agent`.
 *
 * Output is captured to a log file. If auto_advance is enabled, the process
 * exit handler automatically advances to the next step (or marks the pipeline
 * as completed/failed).
 */
async function spawnStep(
  db: ReturnType<typeof getDatabase>,
  pipelineName: string,
  template: { name: string; model: string; task_prompt: string; timeout_seconds: number },
  steps: RunStepState[],
  stepIdx: number,
  runId: number,
  workspaceId: number,
  context?: string | null,
  autoAdvance?: boolean
): Promise<{ success: boolean; spawn_id?: string; error?: string }> {
  let logFd: number | undefined
  try {
    const { spawn } = await import('node:child_process')
    const { config } = await import('@/lib/config')

    const agentId = getPipelineAgentId()
    const spawnId = `pipeline-${runId}-step-${stepIdx}-${Date.now()}`
    const contextBlock = context ? `\n\n--- Task Context ---\n${context}\n--- End Context ---\n\n` : ''
    const args = [
      'agent',
      '--agent', agentId,
      '--message', `[Pipeline: ${pipelineName} | Step ${stepIdx + 1}]${contextBlock}${template.task_prompt}`,
      '--timeout', String(template.timeout_seconds),
      '--json',
    ]

    // Create log file for output capture
    const logsDir = getLogsDir()
    const logPath = path.join(logsDir, `run-${runId}-step-${stepIdx}.log`)
    logFd = fs.openSync(logPath, 'w')

    const child = spawn(config.openclawBin, args, {
      cwd: config.openclawStateDir || process.cwd(),
      stdio: ['ignore', logFd, logFd],
    })

    const processKey = `${runId}-${stepIdx}`
    if (child.pid) runningProcesses.set(processKey, child.pid)

    steps[stepIdx].spawn_id = spawnId
    steps[stepIdx].started_at = Math.floor(Date.now() / 1000)
    steps[stepIdx].pid = child.pid || null
    steps[stepIdx].log_path = logPath
    db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ? AND workspace_id = ?').run(JSON.stringify(steps), runId, workspaceId)

    // Auto-advance: listen for process exit
    child.on('exit', (code) => {
      try { fs.closeSync(logFd) } catch { /* already closed */ }
      runningProcesses.delete(processKey)

      logger.info({ runId, stepIdx, code, pipelineName }, 'Pipeline step process exited')

      if (autoAdvance !== false) {
        handleStepExit(runId, stepIdx, code === 0, code !== 0 ? `exit code ${code}` : undefined, workspaceId)
      }
    })

    child.on('error', (err) => {
      try { fs.closeSync(logFd) } catch { /* already closed */ }
      runningProcesses.delete(processKey)
      logger.error({ err, runId, stepIdx }, 'Pipeline step process error')

      if (autoAdvance !== false) {
        handleStepExit(runId, stepIdx, false, err.message, workspaceId)
      }
    })

    logger.info({ spawnId, agentId, stepIdx, pipelineName, logPath, autoAdvance }, 'Pipeline step spawned')
    return { success: true, spawn_id: spawnId }
  } catch (err: any) {
    // Close log FD if it was opened before spawn threw
    if (typeof logFd === 'number') {
      try { fs.closeSync(logFd) } catch { /* ignore */ }
    }

    const now = Math.floor(Date.now() / 1000)
    steps[stepIdx].status = 'failed'
    steps[stepIdx].completed_at = now
    steps[stepIdx].error = `Spawn failed: ${err.message}`
    db.prepare('UPDATE pipeline_runs SET steps_snapshot = ? WHERE id = ? AND workspace_id = ?').run(JSON.stringify(steps), runId, workspaceId)

    logger.error({ err, stepIdx, pipelineName }, 'Pipeline step spawn failed')

    // Apply on_failure policy so the run doesn't get stuck
    if (autoAdvance !== false) {
      const onFailure = steps[stepIdx].on_failure || 'stop'
      if (onFailure === 'stop') {
        for (let i = stepIdx + 1; i < steps.length; i++) steps[i].status = 'skipped'
        db.prepare('UPDATE pipeline_runs SET status = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
          .run('failed', JSON.stringify(steps), now, runId, workspaceId)
      }
    }

    return { success: false, error: err.message }
  }
}

/** Handle step completion from process exit (auto-advance logic).
 *  This runs asynchronously outside of any HTTP request context.
 */
function handleStepExit(runId: number, stepIdx: number, success: boolean, errorMsg: string | undefined, workspaceId: number) {
  try {
    const db = getDatabase()
    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId) as PipelineRun | undefined
    if (!run || run.status !== 'running') return

    const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
    if (steps[stepIdx].status !== 'running') return  // Guard: already advanced manually

    const now = Math.floor(Date.now() / 1000)
    steps[stepIdx].status = success ? 'completed' : 'failed'
    steps[stepIdx].completed_at = now
    if (errorMsg) steps[stepIdx].error = errorMsg

    const nextIdx = stepIdx + 1
    const onFailure = steps[stepIdx].on_failure || 'stop'

    if (!success && onFailure === 'stop') {
      for (let i = nextIdx; i < steps.length; i++) steps[i].status = 'skipped'
      db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
        .run('failed', stepIdx, JSON.stringify(steps), now, runId, workspaceId)

      onPipelineFinished(db, run, 'failed', workspaceId)
      logger.info({ runId, stepIdx }, 'Pipeline failed (auto-advance: step failed with on_failure=stop)')
      return
    }

    if (nextIdx >= steps.length) {
      const finalStatus = steps.some(s => s.status === 'failed') ? 'completed_with_errors' : 'completed'
      db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
        .run(finalStatus, stepIdx, JSON.stringify(steps), now, runId, workspaceId)

      onPipelineFinished(db, run, finalStatus, workspaceId)
      logger.info({ runId, finalStatus }, 'Pipeline completed (auto-advance)')
      return
    }

    // Spawn next step
    steps[nextIdx].status = 'running'
    steps[nextIdx].started_at = now
    db.prepare('UPDATE pipeline_runs SET current_step = ?, steps_snapshot = ? WHERE id = ? AND workspace_id = ?')
      .run(nextIdx, JSON.stringify(steps), runId, workspaceId)

    const template = db.prepare('SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id = ?')
      .get(steps[nextIdx].template_id) as any

    if (template) {
      const pipeline = db.prepare('SELECT name FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').get(run.pipeline_id, workspaceId) as any
      spawnStep(db, pipeline?.name || '?', template, steps, nextIdx, runId, workspaceId, run.context, run.auto_advance === 1)
    }

    logger.info({ runId, nextIdx }, 'Auto-advanced to next step')
  } catch (err) {
    logger.error({ err, runId, stepIdx }, 'handleStepExit error')
  }
}

/** Called when a pipeline finishes (completed or failed). Updates linked task if any. */
function onPipelineFinished(db: ReturnType<typeof getDatabase>, run: PipelineRun, status: string, workspaceId: number) {
  // Update linked task
  if (run.task_id) {
    const newTaskStatus = status === 'failed' ? 'in_progress' : 'quality_review'
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(newTaskStatus, Math.floor(Date.now() / 1000), run.task_id, workspaceId)
    logger.info({ taskId: run.task_id, newTaskStatus, runId: run.id }, 'Updated linked task status')
  }

  eventBus.broadcast('activity.created', {
    type: status === 'failed' ? 'pipeline_failed' : 'pipeline_completed',
    entity_type: 'pipeline',
    entity_id: run.pipeline_id,
    description: `Pipeline run #${run.id} ${status}`,
    data: { run_id: run.id, task_id: run.task_id },
  })
}

async function startPipeline(db: ReturnType<typeof getDatabase>, pipelineId: number, triggeredBy: string, workspaceId: number, context?: string, taskId?: number, autoAdvance?: boolean) {
  const pipeline = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').get(pipelineId, workspaceId) as any
  if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

  const steps: PipelineStep[] = JSON.parse(pipeline.steps || '[]')
  if (steps.length === 0) return NextResponse.json({ error: 'Pipeline has no steps' }, { status: 400 })

  const templateIds = steps.map(s => s.template_id)
  const templates = db.prepare(
    `SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`
  ).all(...templateIds) as Array<{ id: number; name: string; model: string; task_prompt: string; timeout_seconds: number }>
  const templateMap = new Map(templates.map(t => [t.id, t]))

  const shouldAutoAdvance = autoAdvance !== false  // default true

  // Build step snapshot with new fields
  const stepsSnapshot: RunStepState[] = steps.map((s, i) => ({
    step_index: i,
    template_id: s.template_id,
    template_name: templateMap.get(s.template_id)?.name || 'Unknown',
    on_failure: s.on_failure,
    status: (i === 0 ? 'running' : 'pending') as RunStepState['status'],
    spawn_id: null,
    started_at: i === 0 ? Math.floor(Date.now() / 1000) : null,
    completed_at: null,
    error: null,
    pid: null,
    log_path: null,
  }))

  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    INSERT INTO pipeline_runs (pipeline_id, status, current_step, steps_snapshot, context, task_id, auto_advance, started_at, triggered_by, workspace_id)
    VALUES (?, 'running', 0, ?, ?, ?, ?, ?, ?, ?)
  `).run(pipelineId, JSON.stringify(stepsSnapshot), context || null, taskId || null, shouldAutoAdvance ? 1 : 0, now, triggeredBy, workspaceId)

  const runId = Number(result.lastInsertRowid)

  // Link task back to this pipeline run
  if (taskId) {
    db.prepare('UPDATE tasks SET pipeline_run_id = ?, status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(runId, 'in_progress', now, taskId, workspaceId)
  }

  db.prepare(`
    UPDATE workflow_pipelines SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?
  `).run(now, now, pipelineId, workspaceId)

  // Spawn first step
  const firstTemplate = templateMap.get(steps[0].template_id)
  let spawnResult: any = null
  if (firstTemplate) {
    spawnResult = await spawnStep(db, pipeline.name, firstTemplate, stepsSnapshot, 0, runId, workspaceId, context, shouldAutoAdvance)
  }

  // Re-read steps in case spawnStep's catch block updated them (spawn failure)
  const freshRun = db.prepare('SELECT steps_snapshot, status FROM pipeline_runs WHERE id = ?').get(runId) as { steps_snapshot: string; status: string } | undefined
  const finalSteps = freshRun ? JSON.parse(freshRun.steps_snapshot) : stepsSnapshot
  const finalStatus = freshRun?.status || 'running'

  db_helpers.logActivity('pipeline_started', 'pipeline', pipelineId, triggeredBy, `Started pipeline: ${pipeline.name}`, { run_id: runId, task_id: taskId }, workspaceId)

  eventBus.broadcast('activity.created', {
    type: 'pipeline_started',
    entity_type: 'pipeline',
    entity_id: pipelineId,
    description: `Pipeline "${pipeline.name}" started`,
    data: { run_id: runId, task_id: taskId },
  })

  return NextResponse.json({
    run: {
      id: runId,
      pipeline_id: pipelineId,
      status: finalStatus,
      current_step: 0,
      steps_snapshot: finalSteps,
      spawn: spawnResult,
    }
  }, { status: 201 })
}

async function advanceRun(db: ReturnType<typeof getDatabase>, runId: number, success: boolean, errorMsg: string | undefined, workspaceId: number) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId) as PipelineRun | undefined
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running') return NextResponse.json({ error: `Run is ${run.status}, not running` }, { status: 400 })

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  const currentIdx = run.current_step
  const now = Math.floor(Date.now() / 1000)

  // Guard: skip if step already advanced (race with auto-advance)
  if (steps[currentIdx].status !== 'running') {
    return NextResponse.json({ run: { id: runId, status: run.status, steps_snapshot: steps, note: 'Step already advanced' } })
  }

  steps[currentIdx].status = success ? 'completed' : 'failed'
  steps[currentIdx].completed_at = now
  if (errorMsg) steps[currentIdx].error = errorMsg

  const nextIdx = currentIdx + 1
  const onFailure = steps[currentIdx].on_failure || 'stop'

  if (!success && onFailure === 'stop') {
    for (let i = nextIdx; i < steps.length; i++) steps[i].status = 'skipped'
    db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
      .run('failed', currentIdx, JSON.stringify(steps), now, runId, workspaceId)

    onPipelineFinished(db, run, 'failed', workspaceId)
    return NextResponse.json({ run: { id: runId, status: 'failed', steps_snapshot: steps } })
  }

  if (nextIdx >= steps.length) {
    const finalStatus = steps.some(s => s.status === 'failed') ? 'completed_with_errors' : 'completed'
    db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
      .run(finalStatus, currentIdx, JSON.stringify(steps), now, runId, workspaceId)

    onPipelineFinished(db, run, finalStatus, workspaceId)
    return NextResponse.json({ run: { id: runId, status: finalStatus, steps_snapshot: steps } })
  }

  // Spawn next step
  steps[nextIdx].status = 'running'
  steps[nextIdx].started_at = now

  const template = db.prepare('SELECT id, name, model, task_prompt, timeout_seconds FROM workflow_templates WHERE id = ?')
    .get(steps[nextIdx].template_id) as any

  let spawnResult: any = null
  if (template) {
    const pipeline = db.prepare('SELECT name FROM workflow_pipelines WHERE id = ? AND workspace_id = ?').get(run.pipeline_id, workspaceId) as any
    spawnResult = await spawnStep(db, pipeline?.name || '?', template, steps, nextIdx, runId, workspaceId, run.context, run.auto_advance === 1)
  }

  db.prepare('UPDATE pipeline_runs SET current_step = ?, steps_snapshot = ? WHERE id = ? AND workspace_id = ?')
    .run(nextIdx, JSON.stringify(steps), runId, workspaceId)

  return NextResponse.json({
    run: { id: runId, status: 'running', current_step: nextIdx, steps_snapshot: steps, spawn: spawnResult }
  })
}

function cancelRun(db: ReturnType<typeof getDatabase>, runId: number, workspaceId: number) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId) as PipelineRun | undefined
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running' && run.status !== 'pending') {
    return NextResponse.json({ error: `Run is ${run.status}, cannot cancel` }, { status: 400 })
  }

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  const now = Math.floor(Date.now() / 1000)

  for (const step of steps) {
    if (step.status === 'running') {
      // Only kill PIDs tracked in live memory (safe from PID reuse after restart)
      const processKey = `${runId}-${step.step_index}`
      const livePid = runningProcesses.get(processKey)
      if (livePid) {
        try { process.kill(livePid, 'SIGTERM') } catch { /* already dead */ }
        runningProcesses.delete(processKey)
      }
      step.status = 'skipped'
      step.completed_at = now
    } else if (step.status === 'pending') {
      step.status = 'skipped'
      step.completed_at = now
    }
  }

  db.prepare('UPDATE pipeline_runs SET status = ?, steps_snapshot = ?, completed_at = ? WHERE id = ? AND workspace_id = ?')
    .run('cancelled', JSON.stringify(steps), now, runId, workspaceId)

  return NextResponse.json({ run: { id: runId, status: 'cancelled', steps_snapshot: steps } })
}
