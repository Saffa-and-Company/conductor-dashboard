import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase, db_helpers, logAuditEvent } from '@/lib/db'
import {
  createNimbusIntegrationId,
  getNimbusConfig,
  getNimbusStatus,
  runNimbusAngela,
  runNimbusSam,
  type NimbusAngelaRecommendation,
} from '@/lib/nimbus'
import { logger } from '@/lib/logger'

const postSchema = z.object({
  action: z.enum(['sam-report', 'angela-recommend']),
  days: z.number().int().min(1).max(30).optional(),
  mode: z.enum(['preview-only', 'manual-promote']).optional(),
  funnelSlug: z.string().min(1).optional(),
  project_id: z.number().int().positive().optional(),
})

function resolveProjectId(db: ReturnType<typeof getDatabase>, workspaceId: number, requestedProjectId?: number) {
  if (typeof requestedProjectId === 'number' && Number.isFinite(requestedProjectId)) {
    const existing = db.prepare(`
      SELECT id FROM projects
      WHERE id = ? AND workspace_id = ? AND status = 'active'
      LIMIT 1
    `).get(requestedProjectId, workspaceId) as { id: number } | undefined
    if (existing) return existing.id
  }

  const fallback = db.prepare(`
    SELECT id FROM projects
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY CASE WHEN slug = 'general' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(workspaceId) as { id: number } | undefined

  if (!fallback) {
    throw new Error('No active project available in workspace')
  }

  return fallback.id
}

function createTask(params: {
  db: ReturnType<typeof getDatabase>
  workspaceId: number
  actor: string
  title: string
  description: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  projectId?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}) {
  const now = Math.floor(Date.now() / 1000)
  const projectId = resolveProjectId(params.db, params.workspaceId, params.projectId)
  params.db.prepare(`
    UPDATE projects
    SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(projectId, params.workspaceId)

  const row = params.db.prepare(`
    SELECT ticket_counter FROM projects
    WHERE id = ? AND workspace_id = ?
  `).get(projectId, params.workspaceId) as { ticket_counter: number } | undefined

  if (!row?.ticket_counter) {
    throw new Error('Failed to allocate project ticket number')
  }

  const result = params.db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, project_id, project_ticket_no, created_by,
      created_at, updated_at, tags, metadata, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.title,
    params.description,
    'inbox',
    params.priority || 'medium',
    projectId,
    row.ticket_counter,
    params.actor,
    now,
    now,
    JSON.stringify(params.tags || []),
    JSON.stringify(params.metadata || {}),
    params.workspaceId,
  )

  const taskId = Number(result.lastInsertRowid)
  db_helpers.logActivity(
    'task_created',
    'task',
    taskId,
    params.actor,
    `Created task: ${params.title}`,
    { source: 'nimbus-integration', metadata: params.metadata || {} },
    params.workspaceId,
  )

  return taskId
}

function addComment(params: {
  db: ReturnType<typeof getDatabase>
  workspaceId: number
  taskId: number
  author: string
  content: string
  metadata?: Record<string, unknown>
}) {
  const now = Math.floor(Date.now() / 1000)
  const result = params.db.prepare(`
    INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id)
    VALUES (?, ?, ?, ?, NULL, NULL, ?)
  `).run(params.taskId, params.author, params.content, now, params.workspaceId)

  const commentId = Number(result.lastInsertRowid)
  db_helpers.logActivity(
    'comment_added',
    'comment',
    commentId,
    params.author,
    `Added comment to task ${params.taskId}`,
    { source: 'nimbus-integration', metadata: params.metadata || {} },
    params.workspaceId,
  )

  return commentId
}

function formatArtifactBlock(label: string, payload: unknown) {
  return `**${label}**\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}

function recommendationDescription(rec: NimbusAngelaRecommendation) {
  return [
    `Category: ${rec.category}`,
    `Confidence: ${rec.confidence}`,
    `Requires review: ${rec.requiresReview ? 'yes' : 'no'}`,
    `Strategy dependent: ${rec.strategyDependent ? 'yes' : 'no'}`,
    '',
    `Hypothesis: ${rec.hypothesis}`,
    '',
    `Proposed change: ${rec.proposedChange}`,
    '',
    `Expected impact: ${rec.expectedImpact}`,
    '',
    `Reasoning: ${rec.reasoningSummary}`,
  ].join('\n')
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const config = getNimbusConfig()
    if (!config.configured) {
      return NextResponse.json({
        ok: false,
        configured: false,
        baseUrl: config.baseUrl || null,
        error: 'Nimbus Buy Better integration is not configured',
      }, { status: 200 })
    }

    const status = await getNimbusStatus()
    return NextResponse.json({
      ok: true,
      configured: true,
      baseUrl: config.baseUrl,
      nimbus: status,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/integrations/nimbus error')
    return NextResponse.json({
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Failed to reach Nimbus',
    }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const actor = auth.user.display_name || auth.user.username || 'system'
  const projectId = parsed.data.project_id
  const mode = parsed.data.mode || 'preview-only'

  try {
    if (parsed.data.action === 'sam-report') {
      const remote = await runNimbusSam({ days: parsed.data.days, mode })
      const taskId = createTask({
        db,
        workspaceId,
        actor,
        projectId,
        priority: 'medium',
        title: `Nimbus Sam report review • Buy Better • ${remote.runId}`,
        description: remote.summary,
        tags: ['nimbus', 'buy-better', 'sam-report'],
        metadata: {
          integration: 'nimbus-buy-better',
          action: 'sam-report',
          runId: remote.runId,
          upstreamReportId: remote.reportId || null,
        },
      })

      addComment({
        db,
        workspaceId,
        taskId,
        author: actor,
        content: formatArtifactBlock('Nimbus Sam report artifact', remote),
        metadata: { runId: remote.runId, kind: 'sam-report-artifact' },
      })

      logAuditEvent({
        action: 'nimbus.sam_report.triggered',
        actor,
        actor_id: auth.user.id,
        target_type: 'task',
        target_id: taskId,
        detail: { runId: remote.runId, mode, workspaceId },
        ip_address: request.headers.get('x-forwarded-for') || undefined,
        user_agent: request.headers.get('user-agent') || undefined,
      })

      return NextResponse.json({
        ok: true,
        action: 'sam-report',
        runId: remote.runId,
        summary: remote.summary,
        taskId,
        taskCount: 1,
        upstream: remote,
      })
    }

    const remote = await runNimbusAngela({
      days: parsed.data.days,
      mode,
      funnelSlug: parsed.data.funnelSlug,
    })

    const parentTaskId = createTask({
      db,
      workspaceId,
      actor,
      projectId,
      priority: 'high',
      title: `Nimbus Angela review batch • Buy Better • ${remote.runId}`,
      description: remote.summary,
      tags: ['nimbus', 'buy-better', 'angela-review'],
      metadata: {
        integration: 'nimbus-buy-better',
        action: 'angela-recommend',
        runId: remote.runId,
        upstreamRecommendationSetId: remote.recommendationSetId || null,
      },
    })

    addComment({
      db,
      workspaceId,
      taskId: parentTaskId,
      author: actor,
      content: formatArtifactBlock('Nimbus Angela recommendation artifact', remote),
      metadata: { runId: remote.runId, kind: 'angela-batch-artifact' },
    })

    const createdReviewTasks = remote.recommendationSet.recommendations.map((recommendation) => {
      const taskId = createTask({
        db,
        workspaceId,
        actor,
        projectId,
        priority: recommendation.strategyDependent ? 'medium' : 'high',
        title: `Review Nimbus recommendation • ${recommendation.funnelSlug} • ${recommendation.recommendationId}`,
        description: recommendationDescription(recommendation),
        tags: ['nimbus', 'buy-better', 'recommendation-review', recommendation.category],
        metadata: {
          integration: 'nimbus-buy-better',
          action: 'angela-recommendation',
          runId: remote.runId,
          recommendationId: recommendation.recommendationId,
          funnelSlug: recommendation.funnelSlug,
          parentTaskId,
        },
      })

      addComment({
        db,
        workspaceId,
        taskId,
        author: actor,
        content: formatArtifactBlock('Recommendation detail', recommendation),
        metadata: {
          runId: remote.runId,
          recommendationId: recommendation.recommendationId,
          kind: 'angela-recommendation-artifact',
        },
      })

      return { taskId, recommendationId: recommendation.recommendationId }
    })

    logAuditEvent({
      action: 'nimbus.angela_recommend.triggered',
      actor,
      actor_id: auth.user.id,
      target_type: 'task',
      target_id: parentTaskId,
      detail: { runId: remote.runId, mode, createdReviewTasks: createdReviewTasks.length, workspaceId },
      ip_address: request.headers.get('x-forwarded-for') || undefined,
      user_agent: request.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({
      ok: true,
      action: 'angela-recommend',
      runId: remote.runId,
      summary: remote.summary,
      parentTaskId,
      createdReviewTasks,
      taskCount: 1 + createdReviewTasks.length,
      upstream: remote,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/integrations/nimbus error')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger Nimbus integration' },
      { status: 500 },
    )
  }
}
