'use client'

import { useState, useEffect, useCallback } from 'react'

interface EnvVarInfo {
  redacted: string
  set: boolean
}

interface Integration {
  id: string
  name: string
  category: string
  categoryLabel: string
  envVars: Record<string, EnvVarInfo>
  status: 'connected' | 'partial' | 'not_configured'
  vaultItem: string | null
  testable: boolean
}

interface Category {
  id: string
  label: string
}

interface NimbusIntegrationStatus {
  ok: boolean
  configured: boolean
  baseUrl: string | null
  error?: string
  nimbus?: {
    ok: boolean
    service: string
    status: string
    projectId: string
    capabilities: Record<string, unknown>
  }
}

interface NimbusRunResponse {
  ok: boolean
  action: 'sam-report' | 'angela-recommend'
  runId: string
  summary: string
  taskId?: number
  parentTaskId?: number
  taskCount: number
  createdReviewTasks?: Array<{ taskId: number; recommendationId: string }>
}

function taskHref(taskId: number) {
  return `/tasks?taskId=${taskId}`
}

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [opAvailable, setOpAvailable] = useState(false)
  const [envPath, setEnvPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('ai')

  // Edits: integration id -> env var key -> new value
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null) // integration id being tested
  const [pulling, setPulling] = useState<string | null>(null) // integration id being pulled
  const [pullingAll, setPullingAll] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ integrationId: string; keys: string[] } | null>(null)
  const [nimbusStatus, setNimbusStatus] = useState<NimbusIntegrationStatus | null>(null)
  const [nimbusLoading, setNimbusLoading] = useState(true)
  const [nimbusActionLoading, setNimbusActionLoading] = useState<'sam-report' | 'angela-recommend' | null>(null)
  const [nimbusDays, setNimbusDays] = useState('7')
  const [nimbusFunnelSlug, setNimbusFunnelSlug] = useState('')
  const [nimbusResult, setNimbusResult] = useState<NimbusRunResponse | null>(null)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required')
        return
      }
      if (!res.ok) {
        setError('Failed to load integrations')
        return
      }
      const data = await res.json()
      setIntegrations(data.integrations || [])
      setCategories(data.categories || [])
      setOpAvailable(data.opAvailable ?? false)
      setEnvPath(data.envPath ?? null)
      if (data.categories?.[0]) {
        setActiveCategory(prev => {
          // Keep current if valid, otherwise default to first
          const ids = (data.categories as Category[]).map((c: Category) => c.id)
          return ids.includes(prev) ? prev : ids[0]
        })
      }
    } catch {
      setError('Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

  const fetchNimbusStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/nimbus')
      const data = await res.json()
      setNimbusStatus(data)
    } catch {
      setNimbusStatus({
        ok: false,
        configured: false,
        baseUrl: null,
        error: 'Failed to reach Nimbus integration route',
      })
    } finally {
      setNimbusLoading(false)
    }
  }, [])

  useEffect(() => { fetchNimbusStatus() }, [fetchNimbusStatus])

  const handleEdit = (envKey: string, value: string) => {
    setEdits(prev => ({ ...prev, [envKey]: value }))
  }

  const cancelEdit = (envKey: string) => {
    setEdits(prev => {
      const next = { ...prev }
      delete next[envKey]
      return next
    })
  }

  const toggleReveal = (envKey: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(envKey)) next.delete(envKey)
      else next.add(envKey)
      return next
    })
  }

  const hasChanges = Object.keys(edits).length > 0

  const handleSave = async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: edits }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} variable${data.count === 1 ? '' : 's'}`)
        setEdits({})
        setRevealed(new Set())
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setEdits({})
    setRevealed(new Set())
  }

  const handleRemove = async (envKeys: string[]) => {
    try {
      const res = await fetch(`/api/integrations?keys=${encodeURIComponent(envKeys.join(','))}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Removed ${data.count} variable${data.count === 1 ? '' : 's'}`)
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to remove')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleTest = async (integrationId: string) => {
    setTesting(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Connection successful')
      } else {
        showFeedback(false, data.detail || data.error || 'Test failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setTesting(null)
    }
  }

  const handlePull = async (integrationId: string) => {
    setPulling(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPulling(null)
    }
  }

  const handlePullAll = async () => {
    setPullingAll(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull-all', category: activeCategory }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPullingAll(false)
    }
  }

  const confirmAndRemove = (integrationId: string, keys: string[]) => {
    setConfirmRemove({ integrationId, keys })
  }

  const handleNimbusRun = async (action: 'sam-report' | 'angela-recommend') => {
    setNimbusActionLoading(action)
    try {
      const res = await fetch('/api/integrations/nimbus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          days: Number(nimbusDays),
          funnelSlug: action === 'angela-recommend' ? nimbusFunnelSlug || undefined : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showFeedback(false, data.error || 'Nimbus run failed')
        return
      }
      setNimbusResult(data)
      showFeedback(true, `${action === 'sam-report' ? 'Sam' : 'Angela'} run queued into Task Board`)
      fetchNimbusStatus()
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setNimbusActionLoading(null)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading integrations...</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const filteredIntegrations = integrations.filter(i => i.category === activeCategory)
  const connectedCount = integrations.filter(i => i.status === 'connected').length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Integrations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connectedCount} of {integrations.length} connected
            {envPath && <span className="ml-2 font-mono text-muted-foreground/50">{envPath}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {opAvailable && (
            <>
              <span className="text-2xs px-2 py-1 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                1P CLI
              </span>
              <button
                onClick={handlePullAll}
                disabled={pullingAll}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex items-center gap-1.5"
                title="Pull all vault-backed integrations in this category from 1Password"
              >
                {pullingAll ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v8M5 7l3 3 3-3" />
                    <path d="M3 12v2h10v-2" />
                  </svg>
                )}
                Pull All
              </button>
            </>
          )}
          {hasChanges && (
            <button
              onClick={handleDiscard}
              className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-4 py-1.5 text-xs rounded-md font-medium transition-colors ${
              hasChanges
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
        {categories.map(cat => {
          const catIntegrations = integrations.filter(i => i.category === cat.id)
          const catConnected = catIntegrations.filter(i => i.status === 'connected').length
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors relative whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-card text-foreground border border-border border-b-card -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat.label}
              {catConnected > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 text-2xs rounded-full bg-green-500/15 text-green-400 px-1">
                  {catConnected}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {activeCategory === 'infra' && (
        <NimbusIntegrationCard
          status={nimbusStatus}
          loading={nimbusLoading}
          runningAction={nimbusActionLoading}
          days={nimbusDays}
          funnelSlug={nimbusFunnelSlug}
          result={nimbusResult}
          onDaysChange={setNimbusDays}
          onFunnelSlugChange={setNimbusFunnelSlug}
          onRefresh={fetchNimbusStatus}
          onRunSam={() => handleNimbusRun('sam-report')}
          onRunAngela={() => handleNimbusRun('angela-recommend')}
        />
      )}

      {/* Integration cards */}
      <div className="space-y-3">
        {filteredIntegrations.map(integration => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            edits={edits}
            revealed={revealed}
            opAvailable={opAvailable}
            testing={testing === integration.id}
            pulling={pulling === integration.id}
            onEdit={handleEdit}
            onCancelEdit={cancelEdit}
            onToggleReveal={toggleReveal}
            onTest={() => handleTest(integration.id)}
            onPull={() => handlePull(integration.id)}
            onRemove={() => {
              const setKeys = Object.entries(integration.envVars)
                .filter(([, v]) => v.set)
                .map(([k]) => k)
              if (setKeys.length > 0) confirmAndRemove(integration.id, setKeys)
            }}
          />
        ))}
        {filteredIntegrations.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            No integrations in this category
          </div>
        )}
      </div>

      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).length} unsaved change{Object.keys(edits).length === 1 ? '' : 's'}
          </span>
          <button
            onClick={handleDiscard}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Remove confirmation dialog */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Remove integration?</h3>
            <p className="text-xs text-muted-foreground">
              This will remove {confirmRemove.keys.length === 1 ? (
                <span className="font-mono text-foreground">{confirmRemove.keys[0]}</span>
              ) : (
                <span>{confirmRemove.keys.length} variables</span>
              )} from the .env file. The gateway must be restarted for changes to take effect.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemove(null)}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleRemove(confirmRemove.keys)
                  setConfirmRemove(null)
                }}
                className="px-3 py-1.5 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NimbusIntegrationCard({
  status,
  loading,
  runningAction,
  days,
  funnelSlug,
  result,
  onDaysChange,
  onFunnelSlugChange,
  onRefresh,
  onRunSam,
  onRunAngela,
}: {
  status: NimbusIntegrationStatus | null
  loading: boolean
  runningAction: 'sam-report' | 'angela-recommend' | null
  days: string
  funnelSlug: string
  result: NimbusRunResponse | null
  onDaysChange: (value: string) => void
  onFunnelSlugChange: (value: string) => void
  onRefresh: () => void
  onRunSam: () => void
  onRunAngela: () => void
}) {
  const badgeClass = !status
    ? 'bg-muted text-muted-foreground'
    : status.ok
      ? 'bg-green-500/10 text-green-400'
      : status.configured
        ? 'bg-amber-500/10 text-amber-400'
        : 'bg-destructive/10 text-destructive'

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-foreground">Nimbus Buy Better</span>
            <span className={`text-2xs px-2 py-1 rounded-full ${badgeClass}`}>
              {loading ? 'Checking…' : status?.ok ? 'Ready' : status?.configured ? 'Reachable issue' : 'Not configured'}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Conductor-side operator controls for the Buy Better Nimbus endpoints. Creates Task Board artifacts from Sam and Angela runs.
          </p>
          {status?.baseUrl && (
            <p className="mt-2 text-2xs font-mono text-muted-foreground/70">{status.baseUrl}</p>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          Refresh
        </button>
      </div>

      {status?.error && (
        <div className="rounded-lg bg-destructive/10 text-destructive p-3 text-xs">
          {status.error}
        </div>
      )}

      {status?.nimbus && (
        <div className="grid gap-3 md:grid-cols-3 text-xs">
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <div className="text-muted-foreground">Service</div>
            <div className="mt-1 font-medium text-foreground">{status.nimbus.service}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <div className="text-muted-foreground">Status</div>
            <div className="mt-1 font-medium text-foreground">{status.nimbus.status}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <div className="text-muted-foreground">Project</div>
            <div className="mt-1 font-medium text-foreground">{status.nimbus.projectId}</div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Date window
          </span>
          <input
            type="number"
            min="1"
            max="30"
            value={days}
            onChange={(e) => onDaysChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Funnel filter for Angela
          </span>
          <input
            type="text"
            value={funnelSlug}
            onChange={(e) => onFunnelSlugChange(e.target.value)}
            placeholder="Optional: checkout"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onRunSam}
          disabled={runningAction !== null || !status?.configured}
          className="px-4 py-2 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {runningAction === 'sam-report' ? 'Running Sam…' : 'Run Sam Report'}
        </button>
        <button
          onClick={onRunAngela}
          disabled={runningAction !== null || !status?.configured}
          className="px-4 py-2 text-xs rounded-md border border-border text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {runningAction === 'angela-recommend' ? 'Running Angela…' : 'Run Angela Recommendations'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-background/50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">Latest run</span>
            <span className="text-2xs font-mono text-muted-foreground">{result.runId}</span>
          </div>
          <p className="text-xs text-muted-foreground">{result.summary}</p>
          <div className="text-2xs text-muted-foreground">
            {result.action === 'sam-report' && result.taskId && (
              <a
                href={taskHref(result.taskId)}
                className="text-primary hover:underline"
              >
                Open Task #{result.taskId}
              </a>
            )}
            {result.action === 'angela-recommend' && (
              <div className="space-y-2">
                {result.parentTaskId && (
                  <a
                    href={taskHref(result.parentTaskId)}
                    className="block text-primary hover:underline"
                  >
                    Open parent task #{result.parentTaskId}
                  </a>
                )}
                <div>
                  Created {result.createdReviewTasks?.length || 0} review task{(result.createdReviewTasks?.length || 0) === 1 ? '' : 's'}:
                </div>
                <div className="flex flex-wrap gap-2">
                  {(result.createdReviewTasks || []).map((task) => (
                    <a
                      key={task.recommendationId}
                      href={taskHref(task.taskId)}
                      className="rounded-full border border-border px-2.5 py-1 text-[11px] text-primary hover:bg-secondary"
                    >
                      #{task.taskId}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integration card component
// ---------------------------------------------------------------------------

function IntegrationCard({
  integration,
  edits,
  revealed,
  opAvailable,
  testing,
  pulling,
  onEdit,
  onCancelEdit,
  onToggleReveal,
  onTest,
  onPull,
  onRemove,
}: {
  integration: Integration
  edits: Record<string, string>
  revealed: Set<string>
  opAvailable: boolean
  testing: boolean
  pulling: boolean
  onEdit: (key: string, value: string) => void
  onCancelEdit: (key: string) => void
  onToggleReveal: (key: string) => void
  onTest: () => void
  onPull: () => void
  onRemove: () => void
}) {
  const statusColors = {
    connected: 'bg-green-500',
    partial: 'bg-amber-500',
    not_configured: 'bg-muted-foreground/30',
  }

  const statusLabels = {
    connected: 'Connected',
    partial: 'Partial',
    not_configured: 'Not configured',
  }

  const hasEdits = Object.keys(integration.envVars).some(k => edits[k] !== undefined)
  const hasSetVars = Object.values(integration.envVars).some(v => v.set)

  return (
    <div className={`bg-card border rounded-lg p-4 transition-colors ${
      hasEdits ? 'border-primary/50' : 'border-border'
    }`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[integration.status]}`} />
          <span className="text-sm font-medium text-foreground">{integration.name}</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {statusLabels[integration.status]}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Pull from 1Password */}
          {integration.vaultItem && opAvailable && (
            <button
              onClick={onPull}
              disabled={pulling}
              title="Pull from 1Password"
              className="px-2 py-1 text-2xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex items-center gap-1"
            >
              {pulling ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3" />
                  <path d="M3 12v2h10v-2" />
                </svg>
              )}
              1P
            </button>
          )}

          {/* Test connection */}
          {integration.testable && hasSetVars && (
            <button
              onClick={onTest}
              disabled={testing}
              title="Test connection"
              className="px-2 py-1 text-2xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex items-center gap-1"
            >
              {testing ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3L6 14" />
                  <polyline points="6,3 6,8 1,8" />
                  <polyline points="10,8 15,8 15,13" />
                </svg>
              )}
              Test
            </button>
          )}

          {/* Remove */}
          {hasSetVars && (
            <button
              onClick={onRemove}
              title="Remove from .env"
              className="px-2 py-1 text-2xs rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Env var rows */}
      <div className="space-y-2">
        {Object.entries(integration.envVars).map(([envKey, info]) => {
          const isEditing = edits[envKey] !== undefined
          const isRevealed = revealed.has(envKey)

          return (
            <div key={envKey} className="flex items-center gap-2">
              <span className="text-2xs font-mono text-muted-foreground/70 w-48 truncate shrink-0" title={envKey}>
                {envKey}
              </span>

              <div className="flex-1 flex items-center gap-1.5">
                {isEditing ? (
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={edits[envKey]}
                    onChange={e => onEdit(envKey, e.target.value)}
                    placeholder="Enter value..."
                    className="flex-1 px-2 py-1 text-xs bg-background border border-primary/50 rounded focus:border-primary focus:outline-none font-mono"
                    autoComplete="off"
                    data-1p-ignore
                  />
                ) : info.set ? (
                  <span className="text-xs font-mono text-muted-foreground">{info.redacted}</span>
                ) : (
                  <span className="text-xs text-muted-foreground/50 italic">not set</span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Reveal toggle (only when editing) */}
                {isEditing && (
                  <button
                    onClick={() => onToggleReveal(envKey)}
                    title={isRevealed ? 'Hide value' : 'Show value'}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                )}

                {/* Edit button */}
                {!isEditing && (
                  <button
                    onClick={() => onEdit(envKey, '')}
                    title="Edit value"
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <EditIcon />
                  </button>
                )}

                {/* Cancel edit */}
                {isEditing && (
                  <button
                    onClick={() => onCancelEdit(envKey)}
                    title="Cancel edit"
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline SVG icons (matching nav-rail pattern: 16x16, stroke-based)
// ---------------------------------------------------------------------------

function EyeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5a2 2 0 002.8 2.8" />
      <path d="M4.2 4.2C2.5 5.5 1 8 1 8s2.5 5 7 5c1.3 0 2.4-.4 3.4-1" />
      <path d="M11.8 11.8C13.5 10.5 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
