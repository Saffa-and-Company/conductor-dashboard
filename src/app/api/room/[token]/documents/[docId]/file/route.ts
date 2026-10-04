import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { getLinkByToken, getRoom, getDocument, validateVisitorSession, resolveExistingFilePath, recordEvent } from '@/lib/data-room'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await params

  const link = getLinkByToken(token)
  if (!link || !link.is_active) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  }

  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: 'Link expired' }, { status: 410 })
  }

  const room = getRoom(link.room_id)
  if (!room || room.status === 'archived') {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const sessionToken = request.cookies.get('dr-session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'Session required' }, { status: 401 })
  }

  const visitor = validateVisitorSession(sessionToken, room.id)
  if (!visitor) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const doc = getDocument(Number(docId))
  if (!doc || doc.room_id !== room.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Check if this is a download request
  const isDownload = request.nextUrl.searchParams.get('download') === '1'
  if (isDownload) {
    const canDownload = !!(link.allow_download || doc.allow_download)
    if (!canDownload) {
      return NextResponse.json({ error: 'Downloads not allowed' }, { status: 403 })
    }
  }

  try {
    const filePath = resolveExistingFilePath(doc.room_id, doc.filename)
    const buffer = readFileSync(filePath)

    // Record viewing event
    recordEvent({
      visitor_id: visitor.id,
      room_id: room.id,
      document_id: doc.id,
      event_type: isDownload ? 'doc_downloaded' : 'doc_viewed',
    })

    const disposition = isDownload
      ? `attachment; filename="${encodeURIComponent(doc.original_name)}"`
      : `inline; filename="${encodeURIComponent(doc.original_name)}"`

    return new Response(buffer, {
      headers: {
        'Content-Type': doc.mime_type,
        'Content-Length': String(buffer.length),
        'Content-Disposition': disposition,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
