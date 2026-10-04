import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync } from 'fs'
import { requireRole } from '@/lib/auth'
import { getRoom, addDocument, resolveSafeDataRoomPath, listDocuments } from '@/lib/data-room'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const roomId = Number(id)
  const room = getRoom(roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, { status: 400 })
  }

  const folder = (formData.get('folder') as string) || ''

  // Generate stored filename: docId will be assigned after insert, use timestamp + sanitized name
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storedFilename = `${Date.now()}-${sanitizedName}`

  // Write file to disk
  const filePath = resolveSafeDataRoomPath(roomId, storedFilename)
  const buffer = Buffer.from(await file.arrayBuffer())
  writeFileSync(filePath, buffer)

  // Get next sort order
  const existingDocs = listDocuments(roomId)
  const maxOrder = existingDocs.reduce((max, d) => Math.max(max, d.sort_order), -1)

  const doc = addDocument({
    room_id: roomId,
    folder,
    filename: storedFilename,
    original_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    file_size: file.size,
    sort_order: maxOrder + 1,
    allow_download: formData.get('allow_download') === 'true',
  })

  return NextResponse.json({ document: doc }, { status: 201 })
}
