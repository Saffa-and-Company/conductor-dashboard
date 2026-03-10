import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import fs from 'node:fs'
import path from 'node:path'

interface PipelineRun {
  id: number
  steps_snapshot: string
}

interface RunStepState {
  log_path: string | null
  status: string
}

/**
 * GET /api/pipelines/run/logs?run_id=7&step=0&tail=200
 * Returns log file content for a pipeline step.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const runId = parseInt(searchParams.get('run_id') || '0')
  const stepIdx = parseInt(searchParams.get('step') || '0')
  const tail = parseInt(searchParams.get('tail') || '500')

  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const db = getDatabase()
  const { config } = await import('@/lib/config')
  const workspaceId = auth.user.workspace_id ?? 1
  const run = db.prepare('SELECT id, steps_snapshot FROM pipeline_runs WHERE id = ? AND workspace_id = ?')
    .get(runId, workspaceId) as PipelineRun | undefined

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  if (stepIdx < 0 || stepIdx >= steps.length) {
    return NextResponse.json({ error: 'Invalid step index' }, { status: 400 })
  }

  const logPath = steps[stepIdx].log_path
  if (!logPath || !fs.existsSync(logPath)) {
    return NextResponse.json({ log: '', status: steps[stepIdx].status, exists: false })
  }

  // Sandbox: ensure logPath resolves under the expected pipeline-logs directory
  const allowedDir = path.resolve(config.dataDir, 'pipeline-logs')
  const resolvedLogPath = path.resolve(logPath)
  if (!resolvedLogPath.startsWith(allowedDir + path.sep) && resolvedLogPath !== allowedDir) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const content = fs.readFileSync(resolvedLogPath, 'utf-8')
  const lines = content.split('\n')
  const truncated = lines.length > tail
  const output = truncated ? lines.slice(-tail).join('\n') : content

  return NextResponse.json({
    log: output,
    lines: lines.length,
    truncated,
    status: steps[stepIdx].status,
    exists: true,
  })
}
