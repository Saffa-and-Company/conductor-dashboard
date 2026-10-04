import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, updateRoom, deleteRoom } from '@/lib/data-room'
import { updateRoomSchema } from '@/lib/data-room-validation'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  return NextResponse.json({ room })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateRoomSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  const room = updateRoom(Number(id), parsed.data)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  return NextResponse.json({ room })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deleted = deleteRoom(Number(id))
  if (!deleted) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  return NextResponse.json({ success: true })
}
