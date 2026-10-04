import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, getVisitorTimeline } from '@/lib/data-room'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; visitorId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, visitorId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const db = getDatabase()
  const visitor = db.prepare('SELECT * FROM data_room_visitors WHERE id = ? AND room_id = ?').get(Number(visitorId), Number(id))
  if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

  const timeline = getVisitorTimeline(Number(visitorId))
  return NextResponse.json({ visitor, timeline })
}
