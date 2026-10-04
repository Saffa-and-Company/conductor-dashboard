import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, getDocument, updateDocument, deleteDocument } from '@/lib/data-room'
import { updateDocumentSchema } from '@/lib/data-room-validation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, docId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const doc = getDocument(Number(docId))
  if (!doc || doc.room_id !== Number(id)) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateDocumentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  const updated = updateDocument(Number(docId), parsed.data)
  return NextResponse.json({ document: updated })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, docId } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const doc = getDocument(Number(docId))
  if (!doc || doc.room_id !== Number(id)) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  deleteDocument(Number(docId))
  return NextResponse.json({ success: true })
}
