import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, statSync, lstatSync, realpathSync } from 'fs'
import { join, sep, dirname, basename } from 'path'
import { getDatabase } from './db'
import { config, ensureDirExists } from './config'
import { eventBus } from './event-bus'

// ─── Types ───────────────────────────────────────────────────────────

export interface DataRoom {
  id: number
  workspace_id: number
  name: string
  slug: string
  status: string
  branding: Record<string, any>
  created_by: string | null
  created_at: number
  updated_at: number
}

export interface DataRoomDocument {
  id: number
  room_id: number
  folder: string
  filename: string
  original_name: string
  mime_type: string
  file_size: number
  sort_order: number
  allow_download: number
  created_at: number
  updated_at: number
}

export interface DataRoomLink {
  id: number
  room_id: number
  token: string
  name: string
  is_active: number
  passcode: string | null
  allow_download: number
  expires_at: number | null
  created_at: number
  updated_at: number
}

export interface DataRoomVisitor {
  id: number
  link_id: number
  room_id: number
  email: string
  name: string
  company: string
  session_token: string
  ip_address: string | null
  user_agent: string | null
  created_at: number
}

export interface DataRoomEvent {
  id: number
  visitor_id: number
  room_id: number
  document_id: number | null
  event_type: string
  page_number: number | null
  duration_seconds: number | null
  metadata: string | null
  created_at: number
}

// ─── Default Branding ────────────────────────────────────────────────

export const DEFAULT_SAHR_BRANDING = {
  companyName: 'Sahr, Rhymes with Car',
  tagline: '',
  logoUrl: '',
  primaryColor: '#0f172a',
  accentColor: '#3b82f6',
}

// ─── Token Generation ────────────────────────────────────────────────

export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// ─── Path Safety ─────────────────────────────────────────────────────

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

export function resolveSafeDataRoomPath(roomId: number, filename: string): string {
  const baseDir = config.dataRoomDir
  ensureDirExists(baseDir)

  const roomDir = join(baseDir, String(roomId))
  ensureDirExists(roomDir)

  // Sanitize filename
  const sanitized = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!sanitized || sanitized.startsWith('.')) {
    throw new Error('Invalid filename')
  }

  const fullPath = join(roomDir, sanitized)

  // Verify path is within room directory
  const baseReal = realpathSync(baseDir)
  const roomDirReal = realpathSync(roomDir)
  if (!isWithinBase(baseReal, roomDirReal)) {
    throw new Error('Path escapes base directory')
  }

  return fullPath
}

export function resolveExistingFilePath(roomId: number, filename: string): string {
  const fullPath = resolveSafeDataRoomPath(roomId, filename)

  if (!existsSync(fullPath)) {
    throw new Error('File not found')
  }

  // Check for symlinks
  const st = lstatSync(fullPath)
  if (st.isSymbolicLink()) {
    throw new Error('Symbolic links are not allowed')
  }

  const baseReal = realpathSync(config.dataRoomDir)
  const fileReal = realpathSync(fullPath)
  if (!isWithinBase(baseReal, fileReal)) {
    throw new Error('Path escapes base directory (symlink)')
  }

  return fullPath
}

// ─── Room CRUD ───────────────────────────────────────────────────────

export function createRoom(data: {
  name: string
  slug: string
  branding?: Record<string, any>
  created_by?: string
  workspace_id?: number
}): DataRoom {
  const db = getDatabase()
  const branding = JSON.stringify(data.branding || DEFAULT_SAHR_BRANDING)
  const result = db.prepare(`
    INSERT INTO data_rooms (name, slug, branding, created_by, workspace_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.name, data.slug, branding, data.created_by || null, data.workspace_id || 1)

  return getRoom(Number(result.lastInsertRowid))!
}

export function getRoom(id: number): DataRoom | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM data_rooms WHERE id = ?').get(id) as any
  if (!row) return null
  return { ...row, branding: JSON.parse(row.branding || '{}') }
}

export function getRoomBySlug(slug: string): DataRoom | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM data_rooms WHERE slug = ?').get(slug) as any
  if (!row) return null
  return { ...row, branding: JSON.parse(row.branding || '{}') }
}

export function listRooms(workspaceId: number = 1): DataRoom[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM data_rooms WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as any[]
  return rows.map(r => ({ ...r, branding: JSON.parse(r.branding || '{}') }))
}

export function updateRoom(id: number, data: {
  name?: string
  slug?: string
  status?: string
  branding?: Record<string, any>
}): DataRoom | null {
  const db = getDatabase()
  const existing = getRoom(id)
  if (!existing) return null

  const updates: string[] = []
  const values: any[] = []

  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.slug !== undefined) { updates.push('slug = ?'); values.push(data.slug) }
  if (data.status !== undefined) { updates.push('status = ?'); values.push(data.status) }
  if (data.branding !== undefined) { updates.push('branding = ?'); values.push(JSON.stringify(data.branding)) }

  if (updates.length === 0) return existing

  updates.push('updated_at = (unixepoch())')
  values.push(id)

  db.prepare(`UPDATE data_rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return getRoom(id)
}

export function deleteRoom(id: number): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM data_rooms WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Document CRUD ───────────────────────────────────────────────────

export function addDocument(data: {
  room_id: number
  folder?: string
  filename: string
  original_name: string
  mime_type: string
  file_size: number
  sort_order?: number
  allow_download?: boolean
}): DataRoomDocument {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO data_room_documents (room_id, folder, filename, original_name, mime_type, file_size, sort_order, allow_download)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.room_id,
    data.folder || '',
    data.filename,
    data.original_name,
    data.mime_type,
    data.file_size,
    data.sort_order || 0,
    data.allow_download ? 1 : 0
  )

  return db.prepare('SELECT * FROM data_room_documents WHERE id = ?').get(Number(result.lastInsertRowid)) as DataRoomDocument
}

export function getDocument(id: number): DataRoomDocument | null {
  const db = getDatabase()
  return db.prepare('SELECT * FROM data_room_documents WHERE id = ?').get(id) as DataRoomDocument | null
}

export function listDocuments(roomId: number): DataRoomDocument[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM data_room_documents WHERE room_id = ? ORDER BY folder, sort_order, created_at').all(roomId) as DataRoomDocument[]
}

export function updateDocument(id: number, data: {
  folder?: string
  sort_order?: number
  allow_download?: boolean
}): DataRoomDocument | null {
  const db = getDatabase()
  const updates: string[] = []
  const values: any[] = []

  if (data.folder !== undefined) { updates.push('folder = ?'); values.push(data.folder) }
  if (data.sort_order !== undefined) { updates.push('sort_order = ?'); values.push(data.sort_order) }
  if (data.allow_download !== undefined) { updates.push('allow_download = ?'); values.push(data.allow_download ? 1 : 0) }

  if (updates.length === 0) return getDocument(id)

  updates.push('updated_at = (unixepoch())')
  values.push(id)

  db.prepare(`UPDATE data_room_documents SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return getDocument(id)
}

export function deleteDocument(id: number): boolean {
  const db = getDatabase()
  const doc = getDocument(id)
  if (!doc) return false

  // Delete file from disk
  try {
    const filePath = resolveExistingFilePath(doc.room_id, doc.filename)
    unlinkSync(filePath)
  } catch {
    // File may already be deleted
  }

  const result = db.prepare('DELETE FROM data_room_documents WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Link CRUD ───────────────────────────────────────────────────────

export function createLink(data: {
  room_id: number
  name?: string
  passcode?: string
  allow_download?: boolean
  expires_at?: number
}): DataRoomLink {
  const db = getDatabase()
  const token = generateToken()
  const result = db.prepare(`
    INSERT INTO data_room_links (room_id, token, name, passcode, allow_download, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.room_id,
    token,
    data.name || '',
    data.passcode || null,
    data.allow_download ? 1 : 0,
    data.expires_at || null
  )

  return db.prepare('SELECT * FROM data_room_links WHERE id = ?').get(Number(result.lastInsertRowid)) as DataRoomLink
}

export function getLinkByToken(token: string): DataRoomLink | null {
  const db = getDatabase()
  return db.prepare('SELECT * FROM data_room_links WHERE token = ?').get(token) as DataRoomLink | null
}

export function listLinks(roomId: number): DataRoomLink[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM data_room_links WHERE room_id = ? ORDER BY created_at DESC').all(roomId) as DataRoomLink[]
}

export function updateLink(id: number, data: {
  name?: string
  is_active?: boolean
  passcode?: string | null
  allow_download?: boolean
  expires_at?: number | null
}): DataRoomLink | null {
  const db = getDatabase()
  const updates: string[] = []
  const values: any[] = []

  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); values.push(data.is_active ? 1 : 0) }
  if (data.passcode !== undefined) { updates.push('passcode = ?'); values.push(data.passcode) }
  if (data.allow_download !== undefined) { updates.push('allow_download = ?'); values.push(data.allow_download ? 1 : 0) }
  if (data.expires_at !== undefined) { updates.push('expires_at = ?'); values.push(data.expires_at) }

  if (updates.length === 0) {
    return db.prepare('SELECT * FROM data_room_links WHERE id = ?').get(id) as DataRoomLink | null
  }

  updates.push('updated_at = (unixepoch())')
  values.push(id)

  db.prepare(`UPDATE data_room_links SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return db.prepare('SELECT * FROM data_room_links WHERE id = ?').get(id) as DataRoomLink | null
}

export function deleteLink(id: number): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM data_room_links WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Visitor Management ──────────────────────────────────────────────

export function createVisitor(data: {
  link_id: number
  room_id: number
  email: string
  name?: string
  company?: string
  ip_address?: string
  user_agent?: string
}): DataRoomVisitor {
  const db = getDatabase()
  const sessionToken = generateSessionToken()

  // Check if visitor already exists for this link+email
  const existing = db.prepare(
    'SELECT * FROM data_room_visitors WHERE link_id = ? AND email = ?'
  ).get(data.link_id, data.email) as DataRoomVisitor | undefined

  if (existing) {
    // Update session token for returning visitor
    db.prepare('UPDATE data_room_visitors SET session_token = ?, ip_address = ?, user_agent = ? WHERE id = ?')
      .run(sessionToken, data.ip_address || null, data.user_agent || null, existing.id)
    return { ...existing, session_token: sessionToken, ip_address: data.ip_address || null, user_agent: data.user_agent || null }
  }

  const result = db.prepare(`
    INSERT INTO data_room_visitors (link_id, room_id, email, name, company, session_token, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.link_id,
    data.room_id,
    data.email,
    data.name || '',
    data.company || '',
    sessionToken,
    data.ip_address || null,
    data.user_agent || null
  )

  return db.prepare('SELECT * FROM data_room_visitors WHERE id = ?').get(Number(result.lastInsertRowid)) as DataRoomVisitor
}

export function getVisitorBySession(sessionToken: string): DataRoomVisitor | null {
  const db = getDatabase()
  return db.prepare('SELECT * FROM data_room_visitors WHERE session_token = ?').get(sessionToken) as DataRoomVisitor | null
}

export function validateVisitorSession(sessionToken: string, roomId: number): DataRoomVisitor | null {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM data_room_visitors WHERE session_token = ? AND room_id = ?'
  ).get(sessionToken, roomId) as DataRoomVisitor | null
}

// ─── Event Recording ─────────────────────────────────────────────────

export function recordEvent(data: {
  visitor_id: number
  room_id: number
  document_id?: number
  event_type: string
  page_number?: number
  duration_seconds?: number
  metadata?: Record<string, any>
}): DataRoomEvent {
  const db = getDatabase()

  // Backfill duration for previous page_viewed event (same visitor + doc)
  if (data.event_type === 'page_viewed' && data.document_id) {
    const prev = db.prepare(`
      SELECT id FROM data_room_events
      WHERE visitor_id = ? AND document_id = ? AND event_type = 'page_viewed' AND duration_seconds IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(data.visitor_id, data.document_id) as { id: number } | undefined

    if (prev) {
      db.prepare(`
        UPDATE data_room_events
        SET duration_seconds = (unixepoch()) - created_at
        WHERE id = ?
      `).run(prev.id)
    }
  }

  const result = db.prepare(`
    INSERT INTO data_room_events (visitor_id, room_id, document_id, event_type, page_number, duration_seconds, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.visitor_id,
    data.room_id,
    data.document_id || null,
    data.event_type,
    data.page_number || null,
    data.duration_seconds || null,
    data.metadata ? JSON.stringify(data.metadata) : null
  )

  const event = db.prepare('SELECT * FROM data_room_events WHERE id = ?').get(Number(result.lastInsertRowid)) as DataRoomEvent

  // Broadcast events
  if (data.event_type === 'doc_viewed') {
    eventBus.broadcast('dataroom.document_viewed', { room_id: data.room_id, document_id: data.document_id, visitor_id: data.visitor_id })
  } else if (data.event_type === 'doc_downloaded') {
    eventBus.broadcast('dataroom.document_downloaded', { room_id: data.room_id, document_id: data.document_id, visitor_id: data.visitor_id })
  }

  return event
}

// ─── Analytics Queries ───────────────────────────────────────────────

export interface RoomAnalytics {
  total_visitors: number
  total_views: number
  total_downloads: number
  total_time_seconds: number
  visitors: VisitorSummary[]
  documents: DocumentStats[]
}

export interface VisitorSummary {
  id: number
  email: string
  name: string
  company: string
  first_visit: number
  last_visit: number
  total_views: number
  total_downloads: number
  total_time_seconds: number
}

export interface DocumentStats {
  id: number
  original_name: string
  folder: string
  total_views: number
  total_downloads: number
  avg_time_seconds: number
  unique_viewers: number
}

export function getRoomAnalytics(roomId: number): RoomAnalytics {
  const db = getDatabase()

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT id) FROM data_room_visitors WHERE room_id = ?) as total_visitors,
      (SELECT COUNT(*) FROM data_room_events WHERE room_id = ? AND event_type = 'doc_viewed') as total_views,
      (SELECT COUNT(*) FROM data_room_events WHERE room_id = ? AND event_type = 'doc_downloaded') as total_downloads,
      (SELECT COALESCE(SUM(duration_seconds), 0) FROM data_room_events WHERE room_id = ? AND duration_seconds IS NOT NULL) as total_time_seconds
  `).get(roomId, roomId, roomId, roomId) as any

  const visitors = db.prepare(`
    SELECT
      v.id, v.email, v.name, v.company, v.created_at as first_visit,
      (SELECT MAX(e.created_at) FROM data_room_events e WHERE e.visitor_id = v.id) as last_visit,
      (SELECT COUNT(*) FROM data_room_events e WHERE e.visitor_id = v.id AND e.event_type = 'doc_viewed') as total_views,
      (SELECT COUNT(*) FROM data_room_events e WHERE e.visitor_id = v.id AND e.event_type = 'doc_downloaded') as total_downloads,
      (SELECT COALESCE(SUM(e.duration_seconds), 0) FROM data_room_events e WHERE e.visitor_id = v.id AND e.duration_seconds IS NOT NULL) as total_time_seconds
    FROM data_room_visitors v
    WHERE v.room_id = ?
    ORDER BY v.created_at DESC
  `).all(roomId) as VisitorSummary[]

  const documents = db.prepare(`
    SELECT
      d.id, d.original_name, d.folder,
      (SELECT COUNT(*) FROM data_room_events e WHERE e.document_id = d.id AND e.event_type = 'doc_viewed') as total_views,
      (SELECT COUNT(*) FROM data_room_events e WHERE e.document_id = d.id AND e.event_type = 'doc_downloaded') as total_downloads,
      (SELECT COALESCE(AVG(e.duration_seconds), 0) FROM data_room_events e WHERE e.document_id = d.id AND e.duration_seconds IS NOT NULL) as avg_time_seconds,
      (SELECT COUNT(DISTINCT e.visitor_id) FROM data_room_events e WHERE e.document_id = d.id AND e.event_type = 'doc_viewed') as unique_viewers
    FROM data_room_documents d
    WHERE d.room_id = ?
    ORDER BY d.sort_order, d.created_at
  `).all(roomId) as DocumentStats[]

  return { ...totals, visitors, documents }
}

export function getVisitorTimeline(visitorId: number): (DataRoomEvent & { document_name?: string })[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT e.*, d.original_name as document_name
    FROM data_room_events e
    LEFT JOIN data_room_documents d ON d.id = e.document_id
    WHERE e.visitor_id = ?
    ORDER BY e.created_at ASC
  `).all(visitorId) as any[]
}

export function getDocumentHeatmap(docId: number): { page_number: number; total_views: number; avg_duration: number }[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT
      page_number,
      COUNT(*) as total_views,
      COALESCE(AVG(duration_seconds), 0) as avg_duration
    FROM data_room_events
    WHERE document_id = ? AND event_type = 'page_viewed' AND page_number IS NOT NULL
    GROUP BY page_number
    ORDER BY page_number ASC
  `).all(docId) as any[]
}

export function exportAnalyticsCSV(roomId: number): string {
  const db = getDatabase()
  const events = db.prepare(`
    SELECT
      v.email, v.name, v.company,
      d.original_name as document_name, d.folder,
      e.event_type, e.page_number, e.duration_seconds,
      datetime(e.created_at, 'unixepoch') as event_time
    FROM data_room_events e
    JOIN data_room_visitors v ON v.id = e.visitor_id
    LEFT JOIN data_room_documents d ON d.id = e.document_id
    WHERE e.room_id = ?
    ORDER BY e.created_at ASC
  `).all(roomId) as any[]

  const headers = ['Email', 'Name', 'Company', 'Document', 'Folder', 'Event Type', 'Page', 'Duration (s)', 'Time']
  const rows = events.map((e: any) => [
    e.email, e.name, e.company, e.document_name || '', e.folder || '',
    e.event_type, e.page_number ?? '', e.duration_seconds ?? '', e.event_time
  ])

  return [headers, ...rows].map(row =>
    row.map((cell: any) => {
      const str = String(cell ?? '')
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  ).join('\n')
}
