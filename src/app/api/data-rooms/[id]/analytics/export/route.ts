import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRoom, exportAnalyticsCSV } from '@/lib/data-room'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const room = getRoom(Number(id))
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const csv = exportAnalyticsCSV(Number(id))

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="data-room-${room.slug}-analytics.csv"`,
    },
  })
}
