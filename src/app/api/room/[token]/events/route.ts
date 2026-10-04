import { NextRequest, NextResponse } from 'next/server'
import { getLinkByToken, getRoom, getDocument, validateVisitorSession, recordEvent } from '@/lib/data-room'
import { recordEventSchema } from '@/lib/data-room-validation'

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const link = getLinkByToken(token)
  if (!link || !link.is_active) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  }

  const room = getRoom(link.room_id)
  if (!room) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = recordEventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  // Verify document belongs to this room
  const doc = getDocument(parsed.data.document_id)
  if (!doc || doc.room_id !== room.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const event = recordEvent({
    visitor_id: visitor.id,
    room_id: room.id,
    document_id: parsed.data.document_id,
    event_type: parsed.data.event_type,
    page_number: parsed.data.page_number,
    duration_seconds: parsed.data.duration_seconds,
  })

  return NextResponse.json({ event_id: event.id })
}
