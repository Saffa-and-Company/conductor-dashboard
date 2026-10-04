'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────

interface DataRoom {
  id: number
  name: string
  slug: string
  status: string
  branding: Record<string, any>
  created_at: number
  updated_at: number
}

interface DataRoomDocument {
  id: number
  room_id: number
  folder: string
  original_name: string
  mime_type: string
  file_size: number
  sort_order: number
  allow_download: number
}

interface DataRoomLink {
  id: number
  room_id: number
  token: string
  name: string
  is_active: number
  passcode: string | null
  allow_download: number
  expires_at: number | null
  created_at: number
}

interface VisitorSummary {
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

interface DocumentStats {
  id: number
  original_name: string
  folder: string
  total_views: number
  total_downloads: number
  avg_time_seconds: number
  unique_viewers: number
}

interface RoomAnalytics {
  total_visitors: number
  total_views: number
  total_downloads: number
  total_time_seconds: number
  visitors: VisitorSummary[]
  documents: DocumentStats[]
}

interface TimelineEvent {
  id: number
  event_type: string
  document_name?: string
  page_number: number | null
  duration_seconds: number | null
  created_at: number
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

// ─── Main Panel ──────────────────────────────────────────────────────

export function DataRoomPanel() {
  const [rooms, setRooms] = useState<DataRoom[]>([])
  const [selectedRoom, setSelectedRoom] = useState<DataRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const fetchRooms = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/data-rooms')
      if (!res.ok) throw new Error('Failed to fetch rooms')
      const data = await res.json()
      setRooms(data.rooms || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRooms() }, [fetchRooms])

  if (selectedRoom) {
    return <RoomDetail room={selectedRoom} onBack={() => { setSelectedRoom(null); fetchRooms() }} />
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Data Room</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage investor data rooms and share links</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + New Room
        </button>
      </div>

      {showCreateForm && (
        <CreateRoomForm
          onCreated={(room) => { setRooms(prev => [room, ...prev]); setShowCreateForm(false) }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">No data rooms yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rooms.map(room => (
            <button
              key={room.id}
              onClick={() => setSelectedRoom(room)}
              className="w-full text-left p-4 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{room.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">/{room.slug}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  room.status === 'active' ? 'bg-green-500/15 text-green-500' :
                  room.status === 'archived' ? 'bg-muted text-muted-foreground' :
                  'bg-yellow-500/15 text-yellow-500'
                }`}>
                  {room.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Create Room Form ────────────────────────────────────────────────

function CreateRoomForm({ onCreated, onCancel }: { onCreated: (room: DataRoom) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
    }
  }

  const handleSubmit = async () => {
    if (!name || !slug) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/data-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create room')
      }
      const data = await res.json()
      onCreated(data.room)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 p-4 rounded-xl border border-border bg-card">
      <h3 className="font-medium text-foreground mb-3">Create Data Room</h3>
      {error && <div className="mb-3 p-2 bg-destructive/10 text-destructive text-sm rounded">{error}</div>}
      <div className="grid gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Room Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Series A Fundraise"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">URL Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="series-a-fundraise"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={handleSubmit}
          disabled={submitting || !name || !slug}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Room'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Room Detail ─────────────────────────────────────────────────────

function RoomDetail({ room: initialRoom, onBack }: { room: DataRoom; onBack: () => void }) {
  const [room, setRoom] = useState(initialRoom)
  const [activeTab, setActiveTab] = useState<'documents' | 'links' | 'branding' | 'analytics'>('documents')

  const refreshRoom = useCallback(async () => {
    const res = await fetch(`/api/data-rooms/${room.id}`)
    if (res.ok) {
      const data = await res.json()
      setRoom(data.room)
    }
  }, [room.id])

  const tabs = [
    { id: 'documents' as const, label: 'Documents' },
    { id: 'links' as const, label: 'Links' },
    { id: 'branding' as const, label: 'Branding' },
    { id: 'analytics' as const, label: 'Analytics' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3l-5 5 5 5" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">{room.name}</h1>
          <p className="text-xs text-muted-foreground">/{room.slug}</p>
        </div>
        <RoomStatusToggle room={room} onUpdated={setRoom} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'documents' && <DocumentsTab roomId={room.id} />}
      {activeTab === 'links' && <LinksTab roomId={room.id} />}
      {activeTab === 'branding' && <BrandingTab room={room} onUpdated={refreshRoom} />}
      {activeTab === 'analytics' && <AnalyticsTab roomId={room.id} />}
    </div>
  )
}

function RoomStatusToggle({ room, onUpdated }: { room: DataRoom; onUpdated: (r: DataRoom) => void }) {
  const [updating, setUpdating] = useState(false)

  const toggleStatus = async () => {
    const newStatus = room.status === 'active' ? 'draft' : 'active'
    setUpdating(true)
    try {
      const res = await fetch(`/api/data-rooms/${room.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdated(data.room)
      }
    } finally {
      setUpdating(false)
    }
  }

  return (
    <button
      onClick={toggleStatus}
      disabled={updating}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        room.status === 'active'
          ? 'bg-green-500/15 text-green-500 hover:bg-green-500/25'
          : 'bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25'
      }`}
    >
      {updating ? '...' : room.status === 'active' ? 'Active' : 'Draft'}
    </button>
  )
}

// ─── Documents Tab ───────────────────────────────────────────────────

function DocumentsTab({ roomId }: { roomId: number }) {
  const [documents, setDocuments] = useState<DataRoomDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/data-rooms/${roomId}`)
      if (!res.ok) return
      // Documents are fetched via the room's analytics or directly
      // For now, use a simple list fetch by getting analytics which includes docs
      const analyticsRes = await fetch(`/api/data-rooms/${roomId}/analytics`)
      if (analyticsRes.ok) {
        const data = await analyticsRes.json()
        // We need the full doc list, let's get it from room endpoint
      }
    } catch { /* ignore */ }
  }, [roomId])

  const fetchDocsList = useCallback(async () => {
    try {
      setLoading(true)
      // Use the analytics endpoint to get doc list, or we query documents from the server
      const res = await fetch(`/api/data-rooms/${roomId}/analytics`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.analytics?.documents?.map((d: any) => ({
          id: d.id,
          room_id: roomId,
          folder: d.folder || '',
          original_name: d.original_name,
          mime_type: '',
          file_size: 0,
          sort_order: 0,
          allow_download: 0,
          ...d,
        })) || [])
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => { fetchDocsList() }, [fetchDocsList])

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        await fetch(`/api/data-rooms/${roomId}/documents`, {
          method: 'POST',
          body: formData,
        })
      }
      fetchDocsList()
    } catch { /* ignore */ } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId: number) => {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/data-rooms/${roomId}/documents/${docId}`, { method: 'DELETE' })
    fetchDocsList()
  }

  return (
    <div>
      {/* Upload area */}
      <div
        className="border-2 border-dashed border-border rounded-xl p-8 mb-4 text-center hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary') }}
        onDragLeave={(e) => { e.currentTarget.classList.remove('border-primary') }}
        onDrop={(e) => {
          e.preventDefault()
          e.currentTarget.classList.remove('border-primary')
          handleUpload(e.dataTransfer.files)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        {uploading ? (
          <p className="text-sm text-muted-foreground">Uploading...</p>
        ) : (
          <>
            <svg className="w-8 h-8 mx-auto mb-2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <p className="text-sm text-muted-foreground">Drop files here or click to upload</p>
            <p className="text-xs text-muted-foreground/60 mt-1">PDF, images, and other documents (max 50MB)</p>
          </>
        )}
      </div>

      {/* Document list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No documents uploaded yet</p>
      ) : (
        <div className="space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <div className="w-8 h-8 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 1.5h7l3 3V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2.5a1 1 0 011-1z" />
                  <path d="M10 1.5V5h3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{doc.original_name}</p>
                {doc.folder && <p className="text-xs text-muted-foreground">{doc.folder}</p>}
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Delete document"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 10a1 1 0 001 1h6a1 1 0 001-1l1-10" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Links Tab ───────────────────────────────────────────────────────

function LinksTab({ roomId }: { roomId: number }) {
  const [links, setLinks] = useState<DataRoomLink[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newLinkName, setNewLinkName] = useState('')
  const [newLinkPasscode, setNewLinkPasscode] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/data-rooms/${roomId}/links`)
      if (res.ok) {
        const data = await res.json()
        setLinks(data.links || [])
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => { fetchLinks() }, [fetchLinks])

  const createNewLink = async () => {
    setCreating(true)
    try {
      const body: any = {}
      if (newLinkName) body.name = newLinkName
      if (newLinkPasscode) body.passcode = newLinkPasscode
      const res = await fetch(`/api/data-rooms/${roomId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setNewLinkName('')
        setNewLinkPasscode('')
        fetchLinks()
      }
    } finally {
      setCreating(false)
    }
  }

  const toggleLink = async (linkId: number, isActive: boolean) => {
    await fetch(`/api/data-rooms/${roomId}/links/${linkId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !isActive }),
    })
    fetchLinks()
  }

  const deleteLink = async (linkId: number) => {
    if (!confirm('Delete this link?')) return
    await fetch(`/api/data-rooms/${roomId}/links/${linkId}`, { method: 'DELETE' })
    fetchLinks()
  }

  const copyLink = (link: DataRoomLink) => {
    const url = `${window.location.origin}/room/${link.token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  return (
    <div>
      {/* Create link form */}
      <div className="p-4 rounded-xl border border-border bg-card mb-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Create Share Link</h3>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={newLinkName}
            onChange={(e) => setNewLinkName(e.target.value)}
            placeholder="Link name (optional, e.g. investor name)"
            className="flex-1 min-w-[200px] px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="text"
            value={newLinkPasscode}
            onChange={(e) => setNewLinkPasscode(e.target.value)}
            placeholder="Passcode (optional)"
            className="w-40 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={createNewLink}
            disabled={creating}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Link'}
          </button>
        </div>
      </div>

      {/* Links list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading links...</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No share links yet</p>
      ) : (
        <div className="space-y-2">
          {links.map(link => (
            <div key={link.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <div className={`w-2 h-2 rounded-full shrink-0 ${link.is_active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{link.name || 'Unnamed link'}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">/room/{link.token}</p>
                {link.passcode && <span className="text-xs text-muted-foreground">Has passcode</span>}
                {link.expires_at && (
                  <span className="text-xs text-muted-foreground ml-2">
                    Expires {formatDate(link.expires_at)}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => copyLink(link)}
                  className="px-2 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {copiedId === link.id ? 'Copied!' : 'Copy URL'}
                </button>
                <button
                  onClick={() => toggleLink(link.id, !!link.is_active)}
                  className="px-2 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {link.is_active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => deleteLink(link.id)}
                  className="px-2 py-1 text-xs rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Branding Tab ────────────────────────────────────────────────────

function BrandingTab({ room, onUpdated }: { room: DataRoom; onUpdated: () => void }) {
  const branding = room.branding || {}
  const [companyName, setCompanyName] = useState(branding.companyName || '')
  const [tagline, setTagline] = useState(branding.tagline || '')
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor || '#0f172a')
  const [accentColor, setAccentColor] = useState(branding.accentColor || '#3b82f6')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await fetch(`/api/data-rooms/${room.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branding: { companyName, tagline, primaryColor, accentColor, logoUrl: branding.logoUrl },
        }),
      })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Company Name</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tagline</label>
          <input
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Primary Color</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-8 h-8 rounded border border-border cursor-pointer"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Accent Color</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-8 h-8 rounded border border-border cursor-pointer"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="mt-6 p-4 rounded-xl border border-border" style={{ backgroundColor: primaryColor }}>
        <p className="text-lg font-semibold" style={{ color: accentColor }}>{companyName || 'Company Name'}</p>
        {tagline && <p className="text-sm mt-1" style={{ color: `${accentColor}99` }}>{tagline}</p>}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Branding'}
      </button>
    </div>
  )
}

// ─── Analytics Tab ───────────────────────────────────────────────────

function AnalyticsTab({ roomId }: { roomId: number }) {
  const [analytics, setAnalytics] = useState<RoomAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedVisitor, setSelectedVisitor] = useState<number | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [selectedDocHeatmap, setSelectedDocHeatmap] = useState<number | null>(null)
  const [heatmapData, setHeatmapData] = useState<{ page_number: number; total_views: number; avg_duration: number }[]>([])

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/data-rooms/${roomId}/analytics`)
      if (res.ok) {
        const data = await res.json()
        setAnalytics(data.analytics)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  const loadTimeline = async (visitorId: number) => {
    setSelectedVisitor(visitorId)
    const res = await fetch(`/api/data-rooms/${roomId}/analytics/visitors/${visitorId}`)
    if (res.ok) {
      const data = await res.json()
      setTimeline(data.timeline || [])
    }
  }

  const loadHeatmap = async (docId: number) => {
    setSelectedDocHeatmap(docId)
    const res = await fetch(`/api/data-rooms/${roomId}/analytics/documents/${docId}/heatmap`)
    if (res.ok) {
      const data = await res.json()
      setHeatmapData(data.heatmap || [])
    }
  }

  const exportCSV = () => {
    window.open(`/api/data-rooms/${roomId}/analytics/export`, '_blank')
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading analytics...</p>
  if (!analytics) return <p className="text-sm text-muted-foreground">No analytics data</p>

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Visitors', value: analytics.total_visitors },
          { label: 'Document Views', value: analytics.total_views },
          { label: 'Downloads', value: analytics.total_downloads },
          { label: 'Total Time', value: formatDuration(analytics.total_time_seconds) },
        ].map(stat => (
          <div key={stat.label} className="p-3 rounded-xl border border-border bg-card">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-xl font-semibold text-foreground mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={exportCSV}
          className="px-3 py-1.5 text-xs rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Visitors */}
      <h3 className="text-sm font-medium text-foreground mb-2">Visitors</h3>
      {analytics.visitors.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-6">No visitors yet</p>
      ) : (
        <div className="space-y-2 mb-6">
          {analytics.visitors.map(visitor => (
            <div key={visitor.id}>
              <button
                onClick={() => loadTimeline(selectedVisitor === visitor.id ? -1 : visitor.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedVisitor === visitor.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{visitor.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {visitor.name}{visitor.company ? ` — ${visitor.company}` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{visitor.total_views} views, {visitor.total_downloads} downloads</p>
                    <p>{formatDuration(visitor.total_time_seconds)}</p>
                  </div>
                </div>
              </button>
              {selectedVisitor === visitor.id && timeline.length > 0 && (
                <div className="ml-4 mt-2 pl-4 border-l-2 border-border space-y-1">
                  {timeline.map(event => (
                    <div key={event.id} className="text-xs text-muted-foreground py-1">
                      <span className="text-foreground font-medium">{event.event_type}</span>
                      {event.document_name && <span> — {event.document_name}</span>}
                      {event.page_number && <span> (p.{event.page_number})</span>}
                      {event.duration_seconds != null && <span> — {formatDuration(event.duration_seconds)}</span>}
                      <span className="ml-2">{formatDate(event.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documents */}
      <h3 className="text-sm font-medium text-foreground mb-2">Document Performance</h3>
      {analytics.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No document data</p>
      ) : (
        <div className="space-y-2">
          {analytics.documents.map(doc => (
            <div key={doc.id}>
              <button
                onClick={() => loadHeatmap(selectedDocHeatmap === doc.id ? -1 : doc.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedDocHeatmap === doc.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{doc.original_name}</p>
                    {doc.folder && <p className="text-xs text-muted-foreground">{doc.folder}</p>}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{doc.total_views} views, {doc.unique_viewers} unique, {doc.total_downloads} downloads</p>
                    <p>Avg time: {formatDuration(doc.avg_time_seconds)}</p>
                  </div>
                </div>
              </button>
              {selectedDocHeatmap === doc.id && heatmapData.length > 0 && (
                <div className="mt-2 p-3 rounded-lg border border-border bg-card">
                  <p className="text-xs text-muted-foreground mb-2">Page Attention Heatmap</p>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={heatmapData} layout="vertical">
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis dataKey="page_number" type="category" tick={{ fontSize: 11 }} label={{ value: 'Page', position: 'insideLeft', fontSize: 11 }} width={50} />
                        <Tooltip
                          formatter={(value: any, name: any) => [
                            name === 'total_views' ? `${value} views` : `${Number(value).toFixed(1)}s avg`,
                            name === 'total_views' ? 'Views' : 'Avg Duration'
                          ]}
                          contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                        />
                        <Bar dataKey="total_views" fill="var(--primary, #3b82f6)" radius={[0, 4, 4, 0]}>
                          {heatmapData.map((entry, i) => (
                            <Cell key={i} fillOpacity={0.3 + Math.min((entry.total_views / Math.max(...heatmapData.map(d => d.total_views))) * 0.7, 0.7)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
