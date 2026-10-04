import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { requireRole } from '@/lib/auth'
import { getRoom, getDocument, resolveExistingFilePath } from '@/lib/data-room'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, docId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const doc = getDocument(Number(docId))
  if (!doc || doc.room_id !== Number(id)) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  try {
    const filePath = resolveExistingFilePath(doc.room_id, doc.filename)
    const buffer = readFileSync(filePath)

    return new Response(buffer, {
      headers: {
        'Content-Type': doc.mime_type,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${encodeURIComponent(doc.original_name)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
  }
}
