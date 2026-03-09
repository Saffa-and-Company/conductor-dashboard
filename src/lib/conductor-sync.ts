/**
 * Conductor Sync Adapter
 *
 * Reads Conductor's active-tasks.json and companies.json, maps them into the
 * Mission Control SQLite schema (projects, tasks, agents, activities).
 *
 * Registered as a scheduled task in scheduler.ts and also runs on startup.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import { getDatabase, db_helpers } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'

// ── Conductor data types ────────────────────────────────────────────

interface ConductorPR {
  number: number | null
  url: string | null
  lastCommitSha: string | null
}

interface ConductorChecks {
  tmuxAlive: boolean
  prCreated: boolean
  ciStatus: string | null
  reviews: string[]
}

interface ConductorTask {
  id: string
  executor: string
  company: string
  repoSlug: string
  repoPath: string
  baseBranch: string
  branchName: string
  tmuxSession: string
  worktree: string
  modelTier: number
  model: string
  prompt: string
  startedAt: number
  updatedAt: number
  status: string
  retries: number
  pr: ConductorPR
  checks: ConductorChecks
  redirects?: Array<{ message: string; timestamp: number }>
  lastNotifiedStatus?: string
}

interface ConductorTasksFile {
  tasks: ConductorTask[]
}

interface ConductorCompany {
  name: string
  type: string
  keywords?: string[]
  integrations?: string[]
  repos: Array<{
    path: string
    role: string
    pm: string | null
    context: string
    vercelProject?: string
  }>
}

interface ConductorCompaniesFile {
  companies: Record<string, ConductorCompany>
}

// ── Status mapping ──────────────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  queued: 'inbox',
  running: 'in_progress',
  pr_open: 'review',
  reviewing: 'review',
  ready: 'quality_review',
  merged: 'done',
  failed: 'in_progress',
  cancelled: 'done',
}

const PRIORITY_MAP: Record<number, string> = {
  1: 'urgent',  // tier 1 = opus
  2: 'high',    // tier 2 = sonnet
  3: 'medium',  // tier 3 = haiku
  4: 'low',     // tier 4 = haiku (cheap tasks)
}

// ── File paths ──────────────────────────────────────────────────────

function getConductorDir(): string {
  return join(config.openclawStateDir, 'conductor')
}

function getActiveTasksPath(): string {
  return join(getConductorDir(), 'active-tasks.json')
}

function getCompaniesPath(): string {
  return join(getConductorDir(), 'companies.json')
}

// ── File readers ────────────────────────────────────────────────────

function readActiveTasksFile(): ConductorTask[] {
  const filePath = getActiveTasksPath()
  if (!existsSync(filePath)) return []
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed: ConductorTasksFile = JSON.parse(raw)
    return parsed.tasks || []
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read active-tasks.json')
    return []
  }
}

function readCompaniesFile(): Record<string, ConductorCompany> {
  const filePath = getCompaniesPath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed: ConductorCompaniesFile = JSON.parse(raw)
    return parsed.companies || {}
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read companies.json')
    return {}
  }
}

// ── Extract a short title from the prompt ───────────────────────────

function extractTitle(task: ConductorTask): string {
  // The prompt contains "Task: <description>" — extract that line
  const taskLine = task.prompt.split('\n').find(l => l.startsWith('Task: '))
  if (taskLine) {
    const title = taskLine.replace('Task: ', '').trim()
    // Truncate to 200 chars
    return title.length > 200 ? title.slice(0, 197) + '...' : title
  }
  // Fallback: use the id, cleaned up
  return task.id.replace(/^[a-z-]+-/, '').replace(/-/g, ' ').slice(0, 200)
}

// ── Sync companies → projects ───────────────────────────────────────

function syncCompanies(companies: Record<string, ConductorCompany>): Map<string, number> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const companyToProjectId = new Map<string, number>()

  const findProject = db.prepare('SELECT id FROM projects WHERE slug = ? AND workspace_id = 1')
  const insertProject = db.prepare(`
    INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, status, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, 'active', ?, ?)
  `)
  const updateProject = db.prepare(`
    UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?
  `)

  for (const [key, company] of Object.entries(companies)) {
    const existing = findProject.get(key) as { id: number } | undefined
    const description = `${company.type} — ${company.repos.map(r => r.context).join(', ')}`
    // Ticket prefix: uppercase first 3-4 chars of key
    const prefix = key.replace(/-/g, '').slice(0, 4).toUpperCase()

    if (existing) {
      updateProject.run(company.name, description, now, existing.id)
      companyToProjectId.set(key, existing.id)
    } else {
      try {
        const result = insertProject.run(company.name, key, description, prefix, now, now)
        const projectId = Number(result.lastInsertRowid)
        companyToProjectId.set(key, projectId)
        logger.info({ company: key, projectId }, 'Created project from Conductor company')
      } catch (err: any) {
        // Handle unique constraint on ticket_prefix
        if (err.message?.includes('UNIQUE')) {
          const fallbackPrefix = key.slice(0, 3).toUpperCase() + Math.floor(Math.random() * 10)
          const result = insertProject.run(company.name, key, description, fallbackPrefix, now, now)
          companyToProjectId.set(key, Number(result.lastInsertRowid))
        } else {
          logger.warn({ err, company: key }, 'Failed to create project')
        }
      }
    }
  }

  return companyToProjectId
}

// ── Sync tasks ──────────────────────────────────────────────────────

interface SyncStats {
  tasksCreated: number
  tasksUpdated: number
  statusChanges: number
  projectsSynced: number
}

function syncTasks(
  conductorTasks: ConductorTask[],
  companyToProjectId: Map<string, number>
): SyncStats {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const stats: SyncStats = { tasksCreated: 0, tasksUpdated: 0, statusChanges: 0, projectsSynced: companyToProjectId.size }

  // Find tasks by conductor_id stored in metadata
  const findTask = db.prepare(`
    SELECT id, status, metadata FROM tasks
    WHERE workspace_id = 1 AND json_extract(metadata, '$.conductor_id') = ?
  `)

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      workspace_id, title, description, status, priority,
      assigned_to, created_by, created_at, updated_at,
      tags, metadata, project_id
    ) VALUES (1, ?, ?, ?, ?, ?, 'conductor', ?, ?, ?, ?, ?)
  `)

  const updateTask = db.prepare(`
    UPDATE tasks SET
      status = ?, priority = ?, assigned_to = ?,
      updated_at = ?, tags = ?, metadata = ?,
      outcome = ?, completed_at = ?
    WHERE id = ?
  `)

  db.transaction(() => {
    for (const task of conductorTasks) {
      const mcStatus = STATUS_MAP[task.status] || 'inbox'
      // Failed tasks are always urgent regardless of model tier
      const priority = task.status === 'failed' ? 'urgent' : (PRIORITY_MAP[task.modelTier] || 'medium')
      const title = extractTitle(task)
      const projectId = companyToProjectId.get(task.company) || null

      const tags = JSON.stringify([
        task.company,
        task.executor,
        ...(task.checks.ciStatus ? [`ci:${task.checks.ciStatus}`] : []),
        ...(task.status === 'failed' ? ['failed'] : []),
      ])

      const metadata = JSON.stringify({
        conductor_id: task.id,
        repo_slug: task.repoSlug,
        branch: task.branchName,
        base_branch: task.baseBranch,
        worktree: task.worktree,
        model: task.model,
        model_tier: task.modelTier,
        tmux_session: task.tmuxSession,
        retries: task.retries,
        pr_number: task.pr.number,
        pr_url: task.pr.url,
        pr_commit: task.pr.lastCommitSha,
        ci_status: task.checks.ciStatus,
        tmux_alive: task.checks.tmuxAlive,
        pr_created: task.checks.prCreated,
        reviews: task.checks.reviews,
        conductor_status: task.status,
      })

      // Outcome tracking: merged = success, cancelled = abandoned, failed stays null (still in progress)
      const outcome = task.status === 'merged' ? 'success'
        : task.status === 'cancelled' ? 'abandoned'
        : null
      const completedAt = (task.status === 'merged' || task.status === 'cancelled')
        ? Math.floor(task.updatedAt / 1000)
        : null

      const existing = findTask.get(task.id) as { id: number; status: string; metadata: string } | undefined

      if (existing) {
        const oldStatus = existing.status
        const statusChanged = oldStatus !== mcStatus

        updateTask.run(
          mcStatus, priority, task.tmuxSession,
          Math.floor(task.updatedAt / 1000), tags, metadata,
          outcome, completedAt,
          existing.id
        )
        stats.tasksUpdated++

        if (statusChanged) {
          stats.statusChanges++
          db_helpers.logActivity(
            'task_updated',
            'task',
            existing.id,
            'conductor',
            `Task moved from ${oldStatus} to ${mcStatus} (conductor: ${task.status})`,
            { old_status: oldStatus, new_status: mcStatus, conductor_status: task.status }
          )
        }

        // Broadcast task update
        eventBus.broadcast('task.updated', {
          id: existing.id,
          status: mcStatus,
          conductor_status: task.status,
          pr_url: task.pr.url,
          ci_status: task.checks.ciStatus,
        })
      } else {
        const createdAt = Math.floor(task.startedAt / 1000)
        const result = insertTask.run(
          title, task.prompt, mcStatus, priority,
          task.tmuxSession, createdAt,
          Math.floor(task.updatedAt / 1000),
          tags, metadata, projectId
        )
        const taskId = Number(result.lastInsertRowid)
        stats.tasksCreated++

        db_helpers.logActivity(
          'task_created',
          'task',
          taskId,
          'conductor',
          `Task created: ${title}`,
          { conductor_id: task.id, company: task.company, model: task.model }
        )
      }
    }
  })()

  return stats
}

// ── Sync Conductor agents (tmux sessions → agents table) ────────────

function syncConductorAgents(
  conductorTasks: ConductorTask[],
  companies: Record<string, ConductorCompany>
) {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const findAgent = db.prepare('SELECT id, status, config FROM agents WHERE name = ? AND workspace_id = 1')
  const insertAgent = db.prepare(`
    INSERT INTO agents (workspace_id, name, role, session_key, status, last_seen, last_activity, created_at, updated_at, config)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateAgent = db.prepare(`
    UPDATE agents SET role = ?, status = ?, last_seen = ?, last_activity = ?, updated_at = ?, config = ?
    WHERE name = ? AND workspace_id = 1
  `)

  for (const task of conductorTasks) {
    if (!task.tmuxSession) continue

    const agentStatus = task.checks.tmuxAlive ? 'busy' : 'offline'
    const title = extractTitle(task)
    const activity = task.checks.tmuxAlive
      ? `Working on: ${title}`
      : `Session ended (${task.status})`
    const companyName = companies[task.company]?.name || task.company
    const role = `conductor-agent / ${companyName}`

    const agentConfig = JSON.stringify({
      conductor_task_id: task.id,
      company: task.company,
      company_name: companyName,
      repo_slug: task.repoSlug,
      branch: task.branchName,
      worktree: task.worktree,
      model: task.model,
      model_tier: task.modelTier,
      conductor_status: task.status,
      pr_number: task.pr.number,
      pr_url: task.pr.url,
      ci_status: task.checks.ciStatus,
      tmux_alive: task.checks.tmuxAlive,
      retries: task.retries,
      started_at: task.startedAt,
      // Runtime in minutes
      runtime_minutes: Math.floor((Date.now() - task.startedAt) / 60000),
    })

    const existing = findAgent.get(task.tmuxSession) as { id: number; status: string; config: string } | undefined

    if (existing) {
      updateAgent.run(
        role, agentStatus, now, activity, now, agentConfig,
        task.tmuxSession
      )

      // Log status changes
      if (existing.status !== agentStatus) {
        db_helpers.logActivity(
          'agent_status_change',
          'agent',
          existing.id,
          'conductor',
          `Agent ${task.tmuxSession} → ${agentStatus}`,
          { old_status: existing.status, new_status: agentStatus, task: title }
        )
        eventBus.broadcast('agent.status_changed', {
          id: existing.id,
          name: task.tmuxSession,
          status: agentStatus,
          last_activity: activity,
        })
      }
    } else {
      const result = insertAgent.run(
        task.tmuxSession, role, task.tmuxSession,
        agentStatus, now, activity,
        Math.floor(task.startedAt / 1000), now, agentConfig
      )

      db_helpers.logActivity(
        'agent_status_change',
        'agent',
        Number(result.lastInsertRowid),
        'conductor',
        `Conductor agent created: ${task.tmuxSession}`,
        { task: title, company: companyName, model: task.model }
      )
    }
  }
}

// ── Main sync function ──────────────────────────────────────────────

let lastSyncHash = ''

export async function syncConductorData(): Promise<{ ok: boolean; message: string }> {
  const conductorDir = getConductorDir()
  if (!existsSync(conductorDir)) {
    return { ok: true, message: 'No Conductor data directory found' }
  }

  try {
    // Quick check: skip if files haven't changed
    const tasksPath = getActiveTasksPath()
    if (existsSync(tasksPath)) {
      const stat = statSync(tasksPath)
      const currentHash = `${stat.mtimeMs}-${stat.size}`
      if (currentHash === lastSyncHash) {
        return { ok: true, message: 'No changes detected' }
      }
      lastSyncHash = currentHash
    }

    const companies = readCompaniesFile()
    const tasks = readActiveTasksFile()

    const companyToProjectId = syncCompanies(companies)
    const stats = syncTasks(tasks, companyToProjectId)

    // Create/update agents from Conductor tmux sessions
    syncConductorAgents(tasks, companies)

    const message = [
      `Synced ${tasks.length} tasks`,
      stats.tasksCreated > 0 ? `${stats.tasksCreated} created` : null,
      stats.tasksUpdated > 0 ? `${stats.tasksUpdated} updated` : null,
      stats.statusChanges > 0 ? `${stats.statusChanges} status changes` : null,
      `${companyToProjectId.size} projects`,
    ].filter(Boolean).join(', ')

    if (stats.tasksCreated > 0 || stats.statusChanges > 0) {
      logger.info({ stats }, `Conductor sync: ${message}`)
    }

    return { ok: true, message }
  } catch (err: any) {
    logger.error({ err }, 'Conductor sync failed')
    return { ok: false, message: `Conductor sync failed: ${err.message}` }
  }
}

// ── Completed tasks sync (from completed/ directory) ────────────────

export async function syncCompletedTasks(): Promise<{ ok: boolean; message: string }> {
  const completedDir = join(getConductorDir(), 'completed')
  if (!existsSync(completedDir)) {
    return { ok: true, message: 'No completed tasks directory' }
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  let processed = 0

  const findTask = db.prepare(`
    SELECT id, status FROM tasks
    WHERE workspace_id = 1 AND json_extract(metadata, '$.conductor_id') = ?
  `)
  const markDone = db.prepare(`
    UPDATE tasks SET status = 'done', outcome = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status != 'done'
  `)

  try {
    const files = readdirSync(completedDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = readFileSync(join(completedDir, file), 'utf-8')
        const task: ConductorTask = JSON.parse(raw)
        const outcome = task.status === 'merged' ? 'success'
          : task.status === 'cancelled' ? 'abandoned'
          : 'success'
        const completedAt = Math.floor((task.updatedAt || Date.now()) / 1000)
        const existing = findTask.get(task.id) as { id: number; status: string } | undefined
        if (existing && existing.status !== 'done') {
          markDone.run(outcome, completedAt, now, existing.id)
          processed++
          db_helpers.logActivity(
            'task_updated', 'task', existing.id, 'conductor',
            `Task completed via archive (${task.status})`,
            { conductor_status: task.status, outcome }
          )
        }
      } catch (err) {
        logger.warn({ err, file }, 'Failed to process completed task file')
      }
    }

    return { ok: true, message: processed > 0 ? `Processed ${processed} completed tasks` : 'No new completed tasks' }
  } catch (err: any) {
    return { ok: false, message: `Completed tasks sync failed: ${err.message}` }
  }
}
