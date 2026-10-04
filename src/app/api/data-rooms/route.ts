import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listRooms, createRoom } from '@/lib/data-room'
import { createRoomSchema } from '@/lib/data-room-validation'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rooms = listRooms(auth.user.workspace_id)
  return NextResponse.json({ rooms })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createRoomSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  try {
    const room = createRoom({
      ...parsed.data,
      created_by: auth.user.username,
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ room }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'A room with that slug already exists' }, { status: 409 })
    }
    throw err
  }
}
