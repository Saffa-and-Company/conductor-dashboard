import { NextRequest, NextResponse } from 'next/server'
import { getLinkByToken, getRoom, listDocuments, validateVisitorSession } from '@/lib/data-room'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const link = getLinkByToken(token)
  if (!link || !link.is_active) {
    return NextResponse.json({ error: 'Link not found or inactive' }, { status: 404 })
  }

  // Check expiry
  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 })
  }

  const room = getRoom(link.room_id)
  if (!room || room.status === 'archived') {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // Check visitor session
  const sessionToken = request.cookies.get('dr-session')?.value
  if (!sessionToken) {
    return NextResponse.json({
      room: {
        name: room.name,
        branding: room.branding,
        requires_passcode: !!link.passcode,
      },
      authenticated: false,
    })
  }

  const visitor = validateVisitorSession(sessionToken, room.id)
  if (!visitor) {
    return NextResponse.json({
      room: {
        name: room.name,
        branding: room.branding,
        requires_passcode: !!link.passcode,
      },
      authenticated: false,
    })
  }

  // Authenticated visitor — return full room data
  const documents = listDocuments(room.id)
  const canDownload = !!(link.allow_download)

  return NextResponse.json({
    room: {
      id: room.id,
      name: room.name,
      branding: room.branding,
    },
    authenticated: true,
    visitor: {
      id: visitor.id,
      email: visitor.email,
      name: visitor.name,
    },
    documents: documents.map(d => ({
      id: d.id,
      folder: d.folder,
      original_name: d.original_name,
      mime_type: d.mime_type,
      file_size: d.file_size,
      allow_download: canDownload || !!d.allow_download,
    })),
  })
}
