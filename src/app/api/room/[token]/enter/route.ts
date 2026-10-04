import { NextRequest, NextResponse } from 'next/server'
import { getLinkByToken, getRoom, createVisitor } from '@/lib/data-room'
import { enterRoomSchema } from '@/lib/data-room-validation'
import { eventBus } from '@/lib/event-bus'
import { getDatabase } from '@/lib/db'

// Simple in-memory rate limiter: max 10 entries per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= 10
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const link = getLinkByToken(token)
  if (!link || !link.is_active) {
    return NextResponse.json({ error: 'Link not found or inactive' }, { status: 404 })
  }

  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 })
  }

  const room = getRoom(link.room_id)
  if (!room || room.status === 'archived') {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = enterRoomSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }

  // Verify passcode if required
  if (link.passcode && parsed.data.passcode !== link.passcode) {
    return NextResponse.json({ error: 'Invalid passcode' }, { status: 403 })
  }

  const visitor = createVisitor({
    link_id: link.id,
    room_id: room.id,
    email: parsed.data.email,
    name: parsed.data.name,
    company: parsed.data.company,
    ip_address: ip,
    user_agent: request.headers.get('user-agent') || undefined,
  })

  // Broadcast notification to admin
  eventBus.broadcast('dataroom.visitor_entered', {
    room_id: room.id,
    room_name: room.name,
    visitor_id: visitor.id,
    visitor_email: visitor.email,
    visitor_name: visitor.name,
    visitor_company: visitor.company,
  })

  // Also create a Conductor notification
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'admin',
      'dataroom',
      `New visitor: ${visitor.email}`,
      `${visitor.name || visitor.email}${visitor.company ? ` from ${visitor.company}` : ''} entered data room "${room.name}"`,
      'data_room',
      room.id,
      room.workspace_id
    )
    eventBus.broadcast('notification.created', {
      recipient: 'admin',
      type: 'dataroom',
      title: `New visitor: ${visitor.email}`,
      message: `${visitor.name || visitor.email}${visitor.company ? ` from ${visitor.company}` : ''} entered data room "${room.name}"`,
      source_type: 'data_room',
      source_id: room.id,
      created_at: Math.floor(Date.now() / 1000),
    })
  } catch {
    // Non-critical — visitor still gets access
  }

  const response = NextResponse.json({
    success: true,
    visitor: { id: visitor.id, email: visitor.email, name: visitor.name },
  })

  // Set session cookie (30 days, httpOnly, sameSite lax)
  response.cookies.set('dr-session', visitor.session_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  })

  return response
}
