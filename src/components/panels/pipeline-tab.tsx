'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface WorkflowTemplate {
  id: number
  name: string
  model: string
}

interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: PipelineStep[]
  use_count: number
  last_used_at: number | null
  runs: { total: number; completed: number; failed: number; running: number }
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
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
  pipeline_name?: string
  status: string
  current_step: number
  steps_snapshot: RunStepState[]
  task_id?: number | null
  auto_advance?: number
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}

interface TaskOption {
  id: number
  title: string
  status: string
  project_name?: string
}

export function PipelineTab() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])

  // Form state
  const [formMode, setFormMode] = useState<'hidden' | 'create' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formSteps, setFormSteps] = useState<PipelineStep[]>([])

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [spawning, setSpawning] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Run dialog state
  const [runDialog, setRunDialog] = useState<{ pipelineId: number; pipelineName: string } | null>(null)
  const [runContext, setRunContext] = useState('')
  const [runTaskId, setRunTaskId] = useState<number | null>(null)
  const [runAutoAdvance, setRunAutoAdvance] = useState(true)
  const [availableTasks, setAvailableTasks] = useState<TaskOption[]>([])

  // Log viewer state
  const [viewingLog, setViewingLog] = useState<{ runId: number; step: number } | null>(null)
  const [logContent, setLogContent] = useState('')
  const [logLoading, setLogLoading] = useState(false)

  const fetchData = useCallback(async () => {
    const [tRes, pRes, rRes] = await Promise.all([
      fetch('/api/workflows').then(r => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/pipelines').then(r => r.json()).catch(() => ({ pipelines: [] })),
      fetch('/api/pipelines/run?limit=10').then(r => r.json()).catch(() => ({ runs: [] })),
    ])
    setTemplates(tRes.templates || [])
    setPipelines(pRes.pipelines || [])
    setRuns(rRes.runs || [])
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-poll every 5s when there are active runs
  const activeRuns = runs.filter(r => r.status === 'running')
  useEffect(() => {
    if (activeRuns.length === 0) return
    const timer = setInterval(fetchData, 5000)
    return () => clearInterval(timer)
  }, [activeRuns.length, fetchData])

  // Clear result after 3s
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 3000)
    return () => clearTimeout(timer)
  }, [result])

  // Fetch tasks when run dialog opens
  useEffect(() => {
    if (!runDialog) return
    fetch('/api/tasks?limit=50')
      .then(r => r.json())
      .then(data => setAvailableTasks(data.tasks || []))
      .catch(() => setAvailableTasks([]))
  }, [runDialog])

  // Auto-poll log content when viewing a running step
  useEffect(() => {
    if (!viewingLog) return
    let cancelled = false
    const fetchLog = () => {
      setLogLoading(true)
      fetch(`/api/pipelines/run/logs?run_id=${viewingLog.runId}&step=${viewingLog.step}&tail=500`)
        .then(r => r.json())
        .then(data => {
          if (!cancelled) {
            setLogContent(data.log || '(no output yet)')
            setLogLoading(false)
          }
        })
        .catch(() => { if (!cancelled) { setLogContent('(failed to load log)'); setLogLoading(false) } })
    }
    fetchLog()
    // Find the step to check if still running
    const run = runs.find(r => r.id === viewingLog.runId)
    const step = run?.steps_snapshot[viewingLog.step]
    const isRunning = step?.status === 'running'
    const timer = isRunning ? setInterval(fetchLog, 5000) : undefined
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [viewingLog, runs])

  const closeForm = () => {
    setFormMode('hidden')
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormSteps([])
  }

  const addStep = (templateId: number) => {
    const t = templates.find(t => t.id === templateId)
    if (!t) return
    setFormSteps(s => [...s, { template_id: templateId, template_name: t.name, on_failure: 'stop' }])
  }

  const removeStep = (index: number) => {
    setFormSteps(s => s.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, dir: -1 | 1) => {
    setFormSteps(s => {
      const arr = [...s]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[index], arr[target]] = [arr[target], arr[index]]
      return arr
    })
  }

  const savePipeline = async () => {
    if (!formName || formSteps.length < 2) return
    try {
      const payload = {
        ...(formMode === 'edit' ? { id: editingId } : {}),
        name: formName,
        description: formDesc || null,
        steps: formSteps.map(s => ({ template_id: s.template_id, on_failure: s.on_failure })),
      }
      const res = await fetch('/api/pipelines', {
        method: formMode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        closeForm()
        fetchData()
        setResult({ ok: true, text: formMode === 'edit' ? 'Pipeline updated' : 'Pipeline created' })
      } else {
        const data = await res.json()
        setResult({ ok: false, text: data.error || 'Failed' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    }
  }

  const startEdit = (p: Pipeline) => {
    setFormMode('edit')
    setEditingId(p.id)
    setFormName(p.name)
    setFormDesc(p.description || '')
    setFormSteps(p.steps)
  }

  const deletePipeline = async (id: number) => {
    await fetch(`/api/pipelines?id=${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  // Open run dialog instead of immediately running
  const openRunDialog = (p: Pipeline) => {
    setRunDialog({ pipelineId: p.id, pipelineName: p.name })
    setRunContext('')
    setRunTaskId(null)
    setRunAutoAdvance(true)
  }

  const submitRunDialog = async () => {
    if (!runDialog) return
    setSpawning(runDialog.pipelineId)
    setRunDialog(null)
    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          pipeline_id: runDialog.pipelineId,
          context: runContext || undefined,
          task_id: runTaskId || undefined,
          auto_advance: runAutoAdvance,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, text: `Pipeline started (run #${data.run?.id})${runAutoAdvance ? ' — auto-advancing' : ''}` })
        fetchData()
      } else {
        setResult({ ok: false, text: data.error || 'Failed to start' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    } finally {
      setSpawning(null)
    }
  }

  const advanceRun = async (runId: number, success: boolean) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance', run_id: runId, success }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  const cancelRun = async (runId: number) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      {/* Result message */}
      {result && (
        <div className={`text-xs px-2 py-1 rounded ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.text}
        </div>
      )}

      {/* Active runs banner */}
      {activeRuns.length > 0 && (
        <div className="space-y-2">
          {activeRuns.map(run => (
            <ActiveRunCard key={run.id} run={run} onAdvance={advanceRun} onCancel={cancelRun} onViewLog={(runId, step) => setViewingLog({ runId, step })} />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{pipelines.length} pipelines</span>
        <button
          onClick={() => formMode !== 'hidden' ? closeForm() : setFormMode('create')}
          className="text-xs text-primary hover:underline"
        >
          {formMode !== 'hidden' ? 'Cancel' : '+ New Pipeline'}
        </button>
      </div>

      {/* Create/Edit form */}
      {formMode !== 'hidden' && (
        <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
          <span className="text-xs font-medium">{formMode === 'edit' ? 'Edit Pipeline' : 'New Pipeline'}</span>
          <input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="Pipeline name"
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />

          {/* Step builder */}
          <div className="space-y-1">
            <span className="text-2xs text-muted-foreground">Steps ({formSteps.length})</span>
            {formSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5 p-1.5 rounded bg-secondary/80 text-xs">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-2xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-foreground">{step.template_name || `Template #${step.template_id}`}</span>
                <select
                  value={step.on_failure}
                  onChange={e => setFormSteps(s => s.map((st, idx) => idx === i ? { ...st, on_failure: e.target.value as 'stop' | 'continue' } : st))}
                  className="h-5 px-1 text-2xs rounded bg-secondary border border-border text-foreground"
                >
                  <option value="stop">Stop on fail</option>
                  <option value="continue">Continue on fail</option>
                </select>
                <button onClick={() => moveStep(i, -1)} className="text-muted-foreground hover:text-foreground" title="Move up">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 3v10M4 7l4-4 4 4" /></svg>
                </button>
                <button onClick={() => moveStep(i, 1)} className="text-muted-foreground hover:text-foreground" title="Move down">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 13V3M4 9l4 4 4-4" /></svg>
                </button>
                <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-300">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                </button>
              </div>
            ))}

            {/* Add step dropdown */}
            <select
              onChange={e => { if (e.target.value) { addStep(parseInt(e.target.value)); e.target.value = '' } }}
              className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-muted-foreground"
              defaultValue=""
            >
              <option value="" disabled>+ Add workflow template as step...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.model})</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <button
              onClick={savePipeline}
              disabled={!formName || formSteps.length < 2}
              className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {formMode === 'edit' ? 'Update' : 'Save Pipeline'}
            </button>
          </div>
        </div>
      )}

      {/* Pipeline list */}
      {pipelines.length === 0 && formMode === 'hidden' ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">No pipelines yet</p>
          <p className="text-xs text-muted-foreground">Create a pipeline to chain workflow templates together</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pipelines.map(p => (
            <div key={p.id} className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
              <div className="flex items-center gap-2 p-2">
                <button
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    <span className="text-2xs text-muted-foreground">{p.steps.length} steps</span>
                    {p.use_count > 0 && <span className="text-2xs text-muted-foreground">{p.use_count}x</span>}
                    {p.runs.running > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">running</span>
                    )}
                  </div>
                  {/* Mini step visualization */}
                  <div className="flex items-center gap-0.5 mt-1">
                    {p.steps.map((s, i) => (
                      <div key={i} className="flex items-center gap-0.5">
                        <span className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[80px]">
                          {s.template_name}
                        </span>
                        {i < p.steps.length - 1 && (
                          <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                            <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </button>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                  <button
                    onClick={() => openRunDialog(p)}
                    disabled={spawning === p.id}
                    className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                  >
                    {spawning === p.id ? '...' : 'Run'}
                  </button>
                  <button onClick={() => startEdit(p)} className="h-7 px-1.5 rounded-md bg-secondary text-foreground text-xs hover:bg-secondary/80" title="Edit">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button onClick={() => deletePipeline(p.id)} className="h-7 px-1.5 rounded-md bg-destructive/20 text-destructive text-xs hover:bg-destructive/30" title="Delete">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expanded: pipeline visualization + recent runs */}
              {expandedId === p.id && (
                <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2 space-y-3">
                  <PipelineViz steps={p.steps} />
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

                  {/* Recent runs for this pipeline */}
                  <div>
                    <span className="text-2xs text-muted-foreground">
                      Runs: {p.runs.total} total, {p.runs.completed} completed, {p.runs.failed} failed
                    </span>
                    {runs.filter(r => r.pipeline_id === p.id).slice(0, 3).map(run => (
                      <div key={run.id} className="mt-1 p-2 rounded bg-secondary/50 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Run #{run.id}</span>
                            {run.auto_advance === 1 && <span className="text-2xs text-blue-400">auto</span>}
                            {run.task_id && <span className="text-2xs text-purple-400">task #{run.task_id}</span>}
                          </div>
                          <RunStatusBadge status={run.status} />
                        </div>
                        <RunStepsViz steps={run.steps_snapshot} onViewLog={(step) => setViewingLog({ runId: run.id, step })} />
                        {run.status === 'running' && (
                          <div className="flex gap-1 mt-1.5">
                            <button onClick={() => advanceRun(run.id, true)} className="h-6 px-2 rounded bg-green-500/20 text-green-400 text-2xs hover:bg-green-500/30">
                              Mark Step Done
                            </button>
                            <button onClick={() => advanceRun(run.id, false)} className="h-6 px-2 rounded bg-red-500/20 text-red-400 text-2xs hover:bg-red-500/30">
                              Mark Step Failed
                            </button>
                            <button onClick={() => cancelRun(run.id)} className="h-6 px-2 rounded bg-secondary text-muted-foreground text-2xs hover:bg-secondary/80">
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Run Dialog Modal */}
      {runDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRunDialog(null)}>
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-lg m-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Run: {runDialog.pipelineName}</span>
              <button onClick={() => setRunDialog(null)} className="text-muted-foreground hover:text-foreground">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
              </button>
            </div>

            {/* Context textarea */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Context (task details, repo, instructions)</label>
              <textarea
                value={runContext}
                onChange={e => setRunContext(e.target.value)}
                placeholder="Client: ...\nRepo: ...\nRequest: ..."
                rows={6}
                className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm text-foreground font-mono resize-y"
              />
            </div>

            {/* Task dropdown */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Link to task (optional)</label>
              <select
                value={runTaskId || ''}
                onChange={e => setRunTaskId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
              >
                <option value="">No linked task</option>
                {availableTasks.map(t => (
                  <option key={t.id} value={t.id}>#{t.id} — {t.title} [{t.status}]</option>
                ))}
              </select>
            </div>

            {/* Auto-advance toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runAutoAdvance}
                onChange={e => setRunAutoAdvance(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-foreground">Auto-advance steps on completion</span>
              <span className="text-2xs text-muted-foreground">(recommended)</span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRunDialog(null)} className="h-8 px-3 rounded-md bg-secondary text-foreground text-xs">
                Cancel
              </button>
              <button
                onClick={submitRunDialog}
                className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium"
              >
                Start Pipeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Viewer Modal */}
      {viewingLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setViewingLog(null)}>
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-2xl m-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                Run #{viewingLog.runId} — Step {viewingLog.step + 1} Logs
                {logLoading && <span className="ml-2 text-2xs text-muted-foreground animate-pulse">refreshing...</span>}
              </span>
              <button onClick={() => setViewingLog(null)} className="text-muted-foreground hover:text-foreground">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-xs font-mono text-foreground bg-secondary/50 rounded-md p-3 whitespace-pre-wrap break-all">
              {logContent || '(loading...)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/** Full step visualization with boxes and arrows */
function PipelineViz({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-0.5">
            <div className="px-2 py-1.5 rounded-md border border-border bg-secondary text-xs font-medium text-foreground whitespace-nowrap">
              {s.template_name || `Step ${i + 1}`}
            </div>
            {s.on_failure === 'continue' && (
              <span className="text-2xs text-amber-400">continue on fail</span>
            )}
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 20 12" fill="none" className="w-5 h-3 text-muted-foreground/60 shrink-0">
              <path d="M0 6h16M13 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function formatDuration(startTs: number | null, endTs: number | null): string {
  if (!startTs) return ''
  const end = endTs || Math.floor(Date.now() / 1000)
  const secs = end - startTs
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  return `${mins}m ${remainSecs}s`
}

/** Run steps visualization with colored status dots */
function RunStepsViz({ steps, onViewLog }: { steps: RunStepState[]; onViewLog?: (step: number) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              s.status === 'completed' ? 'bg-green-500' :
              s.status === 'running' ? 'bg-amber-500 animate-pulse' :
              s.status === 'failed' ? 'bg-red-500' :
              s.status === 'skipped' ? 'bg-gray-500' : 'bg-gray-600'
            }`} />
            <button
              onClick={() => onViewLog?.(i)}
              className={`text-2xs whitespace-nowrap hover:underline ${
                s.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'
              }`}
              title={s.log_path ? 'View logs' : 'No logs yet'}
            >
              {s.template_name}
            </button>
            {(s.started_at && (s.status === 'running' || s.status === 'completed' || s.status === 'failed')) && (
              <span className="text-2xs text-muted-foreground/60">
                {formatDuration(s.started_at, s.completed_at)}
              </span>
            )}
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 8 8" className="w-2 h-2 text-muted-foreground/40 shrink-0">
              <path d="M1 4h6M5 2l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'bg-amber-500/20 text-amber-400',
    completed: 'bg-green-500/20 text-green-400',
    completed_with_errors: 'bg-amber-500/20 text-amber-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${styles[status] || 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

/** Active run card shown at top of pipeline tab */
function ActiveRunCard({ run, onAdvance, onCancel, onViewLog }: {
  run: PipelineRun
  onAdvance: (id: number, success: boolean) => void
  onCancel: (id: number) => void
  onViewLog: (runId: number, step: number) => void
}) {
  const currentStep = run.steps_snapshot[run.current_step]
  return (
    <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {run.pipeline_name || `Pipeline #${run.pipeline_id}`} — Run #{run.id}
          </span>
          {run.auto_advance === 1 && <span className="text-2xs px-1 py-0.5 rounded bg-blue-500/20 text-blue-400">auto</span>}
          {run.task_id && <span className="text-2xs px-1 py-0.5 rounded bg-purple-500/20 text-purple-400">task #{run.task_id}</span>}
        </div>
        <span className="text-2xs text-muted-foreground">
          Step {run.current_step + 1}/{run.steps_snapshot.length}
          {currentStep?.started_at && ` (${formatDuration(currentStep.started_at, null)})`}
        </span>
      </div>
      <RunStepsViz steps={run.steps_snapshot} onViewLog={(step) => onViewLog(run.id, step)} />
      <div className="flex gap-1 mt-2">
        <button onClick={() => onViewLog(run.id, run.current_step)} className="h-6 px-2 rounded bg-blue-500/20 text-blue-400 text-2xs hover:bg-blue-500/30">
          View Logs
        </button>
        <button onClick={() => onAdvance(run.id, true)} className="h-6 px-2 rounded bg-green-500/20 text-green-400 text-2xs hover:bg-green-500/30">
          Step Done
        </button>
        <button onClick={() => onAdvance(run.id, false)} className="h-6 px-2 rounded bg-red-500/20 text-red-400 text-2xs hover:bg-red-500/30">
          Step Failed
        </button>
        <button onClick={() => onCancel(run.id)} className="h-6 px-2 rounded bg-secondary text-muted-foreground text-2xs hover:bg-secondary/80 ml-auto">
          Cancel
        </button>
      </div>
    </div>
  )
}
