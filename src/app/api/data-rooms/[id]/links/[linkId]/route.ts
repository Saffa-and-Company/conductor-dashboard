import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, updateLink, deleteLink } from '@/lib/data-room'
import { updateLinkSchema } from '@/lib/data-room-validation'
import { getDatabase } from '@/lib/db'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, linkId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const db = getDatabase()
  const existing = db.prepare('SELECT * FROM data_room_links WHERE id = ? AND room_id = ?').get(Number(linkId), Number(id))
  if (!existing) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateLinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  const link = updateLink(Number(linkId), parsed.data)
  return NextResponse.json({ link })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, linkId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const db = getDatabase()
  const existing = db.prepare('SELECT * FROM data_room_links WHERE id = ? AND room_id = ?').get(Number(linkId), Number(id))
  if (!existing) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  deleteLink(Number(linkId))
  return NextResponse.json({ success: true })
}
