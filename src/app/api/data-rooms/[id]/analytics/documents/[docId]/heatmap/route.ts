import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, getDocument, getDocumentHeatmap } from '@/lib/data-room'

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

  const heatmap = getDocumentHeatmap(Number(docId))
  return NextResponse.json({ heatmap })
}
