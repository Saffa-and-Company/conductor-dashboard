'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as XLSX from 'xlsx'

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
}

// ─── Constants ────────────────────────────────────────────────────────

const COTTON_BLUE = '#00CDFF'
const DEFAULT_ACCENT = '#3b82f6'

// ─── Types ───────────────────────────────────────────────────────────

interface RoomBranding {
  companyName?: string
  tagline?: string
  logoUrl?: string
  primaryColor?: string
  accentColor?: string
}

interface RoomDoc {
  id: number
  folder: string
  original_name: string
  mime_type: string
  file_size: number
  allow_download: boolean
}

interface VisitorInfo {
  id: number
  email: string
  name: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function isPdf(mime: string): boolean {
  return mime === 'application/pdf'
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/')
}

function isSpreadsheet(mime: string, filename: string): boolean {
  if (['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-excel'].includes(mime)
      || mime.includes('spreadsheet')) {
    return true
  }
  // Uploads may store XLSX as application/octet-stream — check extension
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext === 'xlsx' || ext === 'xls'
}

/** Override generic blue accent to cotton-blue */
function resolveAccent(branding: RoomBranding): string {
  const raw = branding.accentColor || DEFAULT_ACCENT
  return raw === DEFAULT_ACCENT ? COTTON_BLUE : raw
}

/** Format a cell value for display — adds commas to numbers, % to decimals that look like percentages */
function formatCellValue(val: string | number | boolean | null, header?: string): string {
  if (val == null) return ''
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'number') {
    const hdr = (header || '').toLowerCase()
    // Percentage detection: header contains %, or value is a decimal between 0 and 1 and header hints at rate/pct
    if (hdr.includes('%') || hdr.includes('percent') || hdr.includes('pct')) {
      return (val * 100).toFixed(2) + '%'
    }
    if ((hdr.includes('rate') || hdr.includes('ratio')) && val > 0 && val < 1) {
      return (val * 100).toFixed(2) + '%'
    }
    // Currency / large number formatting with commas
    if (Number.isInteger(val) || Math.abs(val) >= 100) {
      return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
    }
    return val.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  return String(val)
}

/** Detect if the screen is below md breakpoint */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// ─── Main Component ──────────────────────────────────────────────────

export function DataRoomClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [branding, setBranding] = useState<RoomBranding>({})
  const [roomName, setRoomName] = useState('')
  const [requiresPasscode, setRequiresPasscode] = useState(false)
  const [documents, setDocuments] = useState<RoomDoc[]>([])
  const [visitor, setVisitor] = useState<VisitorInfo | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<RoomDoc | null>(null)

  const fetchRoom = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/room/${token}`)
      if (!res.ok) {
        if (res.status === 410) {
          setError('This link has expired')
        } else if (res.status === 404) {
          setError('This link is no longer active')
        } else {
          setError('Something went wrong')
        }
        return
      }
      const data = await res.json()
      setBranding(data.room?.branding || {})
      setRoomName(data.room?.name || '')
      setRequiresPasscode(data.room?.requires_passcode || false)

      if (data.authenticated) {
        setAuthenticated(true)
        setDocuments(data.documents || [])
        setVisitor(data.visitor || null)
        if (data.documents?.length > 0 && !selectedDoc) {
          setSelectedDoc(data.documents[0])
        }
      }
    } catch {
      setError('Failed to load data room')
    } finally {
      setLoading(false)
    }
  }, [token, selectedDoc])

  useEffect(() => { fetchRoom() }, [fetchRoom])

  const handleEnter = useCallback(async (email: string, name: string, company: string, passcode: string) => {
    try {
      const res = await fetch(`/api/room/${token}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, company, passcode: passcode || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enter')
      }

      // Refetch room data now that we have a session
      await fetchRoom()
    } catch (err: any) {
      throw err
    }
  }, [token, fetchRoom])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
            <svg className="w-8 h-8 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </div>
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <EmailGate
        branding={branding}
        roomName={roomName}
        requiresPasscode={requiresPasscode}
        onEnter={handleEnter}
      />
    )
  }

  return (
    <DocumentViewer
      token={token}
      branding={branding}
      documents={documents}
      selectedDoc={selectedDoc}
      onSelectDoc={setSelectedDoc}
    />
  )
}

// ─── Email Gate ──────────────────────────────────────────────────────

function EmailGate({
  branding,
  roomName,
  requiresPasscode,
  onEnter,
}: {
  branding: RoomBranding
  roomName: string
  requiresPasscode: boolean
  onEnter: (email: string, name: string, company: string, passcode: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [passcode, setPasscode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    setError(null)
    try {
      await onEnter(email, name, company, passcode)
    } catch (err: any) {
      setError(err.message || 'Failed to enter')
    } finally {
      setSubmitting(false)
    }
  }

  const accentColor = resolveAccent(branding)

  return (
    <div className="flex items-center justify-center min-h-screen p-4 relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0f1724] to-[#0a0a0f]" />
      <div
        className="fixed inset-0 opacity-30 animate-pulse"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${accentColor}10, transparent 70%)`,
          animationDuration: '6s',
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Glassmorphism card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-2xl p-8">
          {/* Company branding */}
          <div className="text-center mb-8">
            {branding.logoUrl && (
              <img src={branding.logoUrl} alt="" className="h-10 mx-auto mb-4 object-contain" />
            )}
            <h1 className="text-xl font-semibold text-white">{branding.companyName || roomName}</h1>
            {branding.tagline && (
              <p className="text-sm text-white/50 mt-1">{branding.tagline}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': `${accentColor}40` } as any}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': `${accentColor}40` } as any}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your company"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': `${accentColor}40` } as any}
              />
            </div>
            {requiresPasscode && (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Passcode *</label>
                <input
                  type="text"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter passcode"
                  className="w-full px-4 py-3 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                  style={{ '--tw-ring-color': `${accentColor}40` } as any}
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
              style={{ backgroundColor: accentColor }}
            >
              {submitting ? 'Entering...' : 'View Documents'}
            </button>
          </form>

          <p className="text-[11px] text-white/30 text-center mt-6">
            Secure document sharing powered by Conductor
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Document Viewer ─────────────────────────────────────────────────

function DocumentViewer({
  token,
  branding,
  documents,
  selectedDoc,
  onSelectDoc,
}: {
  token: string
  branding: RoomBranding
  documents: RoomDoc[]
  selectedDoc: RoomDoc | null
  onSelectDoc: (doc: RoomDoc) => void
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [docLoading, setDocLoading] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const isMobile = useIsMobile()
  const accentColor = resolveAccent(branding)

  const toggleFolder = (folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  // Group documents by folder
  const folders = documents.reduce<Record<string, RoomDoc[]>>((acc, doc) => {
    const folder = doc.folder || ''
    if (!acc[folder]) acc[folder] = []
    acc[folder].push(doc)
    return acc
  }, {})

  const handleSelectDoc = (doc: RoomDoc) => {
    if (doc.id === selectedDoc?.id) {
      // Same doc — just close sidebar on mobile
      if (isMobile) setSidebarOpen(false)
      return
    }
    // Trigger loading transition
    setContentVisible(false)
    setDocLoading(true)
    onSelectDoc(doc)

    // Auto-close sidebar on mobile
    if (isMobile) setSidebarOpen(false)

    // Short delay then reveal content with fade
    setTimeout(() => {
      setDocLoading(false)
      setContentVisible(true)
    }, 150)
  }

  const handleDownload = (doc: RoomDoc) => {
    window.open(`/api/room/${token}/documents/${doc.id}/file?download=1`, '_blank')
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/60 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          ${isMobile
            ? `fixed inset-y-0 left-0 z-20 w-72 transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-200 shrink-0 overflow-hidden`
          }
        `}
      >
        <div className="w-72 h-full flex flex-col border-r border-white/10 bg-[#0c0c14]">
          {/* Sidebar header */}
          <div className="p-4 border-b border-white/10 relative">
            <h2 className="text-sm font-semibold text-white truncate">
              {branding.companyName || 'Data Room'}
            </h2>
            {branding.tagline && (
              <p className="text-xs text-white/40 mt-0.5 truncate">{branding.tagline}</p>
            )}
            {/* Cotton-blue underline accent */}
            <div
              className="absolute bottom-0 left-4 right-4 h-px"
              style={{ background: `linear-gradient(to right, ${accentColor}60, transparent)` }}
            />
          </div>

          {/* Document list — collapsible folders */}
          <div className="flex-1 overflow-y-auto p-2">
            {Object.entries(folders).map(([folder, docs]) => {
              const isCollapsed = collapsedFolders.has(folder)
              const hasSelectedInFolder = docs.some(d => d.id === selectedDoc?.id)
              const docCount = docs.length
              return (
                <div key={folder} className="mb-1">
                  {folder ? (
                    <button
                      onClick={() => toggleFolder(folder)}
                      className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-white/5 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <svg
                          className={`w-3 h-3 text-white/40 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                          viewBox="0 0 8 8" fill="currentColor"
                        >
                          <path d="M2 1l4 3-4 3V1z" />
                        </svg>
                        <span className="text-[12px] font-semibold text-white/60 uppercase tracking-wide truncate">
                          {folder}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/30 tabular-nums shrink-0 ml-2">
                        {docCount}
                      </span>
                    </button>
                  ) : null}
                  {(!folder || !isCollapsed) && (
                    <div className={folder ? 'ml-1' : ''}>
                      {docs.map(doc => {
                        const isSelected = selectedDoc?.id === doc.id
                        return (
                          <button
                            key={doc.id}
                            onClick={() => handleSelectDoc(doc)}
                            className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 transition-colors ${
                              isSelected
                                ? 'text-white'
                                : 'text-white/60 hover:text-white hover:bg-white/5'
                            }`}
                            style={isSelected ? {
                              backgroundColor: `${accentColor}15`,
                              borderLeft: `2px solid ${accentColor}`,
                            } : { borderLeft: '2px solid transparent' }}
                          >
                            <div className="flex items-center gap-2">
                              <DocIcon mime={doc.mime_type} filename={doc.original_name} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium truncate">{doc.original_name}</p>
                                <p className="text-[10px] text-white/30">{formatBytes(doc.file_size)}</p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Toggle sidebar — visible on mobile and when sidebar is collapsed on desktop */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`absolute top-3 left-2 z-30 w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors ${
          isMobile || !sidebarOpen ? 'block' : 'hidden'
        }`}
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>

      {/* Document content */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#0e0e18]">
        {selectedDoc ? (
          <>
            {/* Document header with breadcrumb */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="min-w-0">
                {selectedDoc.folder && (
                  <p className="text-[11px] text-white/40 truncate mb-0.5">
                    {selectedDoc.folder}
                    <span className="mx-1.5 text-white/20">/</span>
                  </p>
                )}
                <p className="text-sm font-medium text-white truncate">{selectedDoc.original_name}</p>
              </div>
              {selectedDoc.allow_download && (
                <button
                  onClick={() => handleDownload(selectedDoc)}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors shrink-0 ml-2 border hover:brightness-125"
                  style={{
                    backgroundColor: `${accentColor}15`,
                    borderColor: `${accentColor}40`,
                    color: accentColor,
                  }}
                >
                  Download
                </button>
              )}
            </div>

            {/* Document body with loading/fade */}
            <div className="flex-1 overflow-auto relative">
              {/* Loading overlay */}
              {docLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0e0e18]/80">
                  <div className="w-6 h-6 border-2 border-white/20 rounded-full animate-spin" style={{ borderTopColor: accentColor }} />
                </div>
              )}

              {/* Content with fade transition */}
              <div
                className="h-full transition-opacity duration-200"
                style={{ opacity: contentVisible ? 1 : 0 }}
              >
                {isPdf(selectedDoc.mime_type) ? (
                  <PDFViewer
                    url={`/api/room/${token}/documents/${selectedDoc.id}/file`}
                    docId={selectedDoc.id}
                    token={token}
                    accentColor={accentColor}
                  />
                ) : isImage(selectedDoc.mime_type) ? (
                  <div className="flex items-center justify-center p-8 h-full">
                    <img
                      src={`/api/room/${token}/documents/${selectedDoc.id}/file`}
                      alt={selectedDoc.original_name}
                      className="max-w-full max-h-full object-contain rounded-lg"
                    />
                  </div>
                ) : isSpreadsheet(selectedDoc.mime_type, selectedDoc.original_name) ? (
                  <XLSXViewer
                    url={`/api/room/${token}/documents/${selectedDoc.id}/file`}
                    accentColor={accentColor}
                    branding={branding}
                    docName={selectedDoc.original_name}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center p-8">
                      <DocIcon mime={selectedDoc.mime_type} large filename={selectedDoc.original_name} />
                      <p className="text-white/60 text-sm mt-3">{selectedDoc.original_name}</p>
                      <p className="text-white/30 text-xs mt-1">{formatBytes(selectedDoc.file_size)}</p>
                      {selectedDoc.allow_download && (
                        <button
                          onClick={() => handleDownload(selectedDoc)}
                          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
                          style={{ backgroundColor: accentColor }}
                        >
                          Download File
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Empty state — branded placeholder */
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: `${accentColor}10` }}
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10,9 9,9 8,9" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">Select a document to view</p>
              {branding.companyName && (
                <p className="text-white/20 text-xs mt-1">{branding.companyName}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PDF Viewer ──────────────────────────────────────────────────────

function PDFViewer({ url, docId, token, accentColor }: { url: string; docId: number; token: string; accentColor: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.2)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const renderedPages = useRef<Set<number>>(new Set())
  const pageTimers = useRef<Map<number, number>>(new Map())

  // Load PDF
  useEffect(() => {
    let cancelled = false
    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument({ url }).promise
        if (cancelled) return
        setPdfDoc(doc)
        setNumPages(doc.numPages)
      } catch (err) {
        console.error('Failed to load PDF:', err)
      }
    }
    loadPdf()
    return () => { cancelled = true }
  }, [url])

  // Render visible pages
  useEffect(() => {
    if (!pdfDoc) return

    const renderPage = async (pageNum: number) => {
      if (renderedPages.current.has(pageNum)) return
      const canvas = canvasRefs.current.get(pageNum)
      if (!canvas) return

      renderedPages.current.add(pageNum)
      try {
        const page = await pdfDoc.getPage(pageNum)
        const viewport = page.getViewport({ scale })
        canvas.width = viewport.width
        canvas.height = viewport.height

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        await page.render({ canvas: null, canvasContext: ctx, viewport }).promise
      } catch {
        renderedPages.current.delete(pageNum)
      }
    }

    // Render all pages
    for (let i = 1; i <= numPages; i++) {
      renderPage(i)
    }
  }, [pdfDoc, numPages, scale])

  // Track page visibility with IntersectionObserver
  useEffect(() => {
    if (!containerRef.current || numPages === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number(entry.target.getAttribute('data-page'))
          if (!pageNum) continue

          if (entry.isIntersecting) {
            setCurrentPage(pageNum)
            // Start timing this page
            pageTimers.current.set(pageNum, Date.now())
          } else {
            // Page left viewport — send duration event
            const startTime = pageTimers.current.get(pageNum)
            if (startTime) {
              const duration = (Date.now() - startTime) / 1000
              pageTimers.current.delete(pageNum)
              if (duration >= 1) {
                // Fire and forget — send tracking event
                fetch(`/api/room/${token}/events`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    document_id: docId,
                    event_type: 'page_viewed',
                    page_number: pageNum,
                    duration_seconds: Math.round(duration * 10) / 10,
                  }),
                }).catch(() => {})
              }
            }
          }
        }
      },
      { root: containerRef.current, threshold: 0.5 }
    )

    const pageElements = containerRef.current.querySelectorAll('[data-page]')
    pageElements.forEach(el => observer.observe(el))

    return () => observer.disconnect()
  }, [numPages, docId, token])

  // Flush timers on unmount
  useEffect(() => {
    const timers = pageTimers.current
    return () => {
      timers.forEach((startTime, pageNum) => {
        const duration = (Date.now() - startTime) / 1000
        if (duration >= 1) {
          navigator.sendBeacon?.(
            `/api/room/${token}/events`,
            new Blob([JSON.stringify({
              document_id: docId,
              event_type: 'page_viewed',
              page_number: pageNum,
              duration_seconds: Math.round(duration * 10) / 10,
            })], { type: 'application/json' })
          )
        }
      })
    }
  }, [docId, token])

  if (!pdfDoc) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 rounded-full animate-spin" style={{ borderTopColor: accentColor }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls — enhanced toolbar */}
      <div className="flex items-center justify-center gap-4 px-4 py-2.5 bg-white/[0.03] border-b border-white/5 shrink-0">
        <span className="text-xs text-white/50">
          Page {currentPage} of {numPages}
        </span>
        <div className="flex items-center gap-1 bg-white/5 rounded-lg px-1 py-0.5">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-base font-medium"
          >
            -
          </button>
          <span className="text-xs text-white/50 w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.2))}
            className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-base font-medium"
          >
            +
          </button>
        </div>
      </div>

      {/* Pages — with background offset and page borders */}
      <div ref={containerRef} className="flex-1 overflow-auto py-6 bg-[#1a1a24]">
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              data-page={pageNum}
              className="shadow-xl shadow-black/50 rounded-lg ring-1 ring-white/10"
            >
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNum, el)
                  else canvasRefs.current.delete(pageNum)
                }}
                className="block rounded-lg"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── XLSX Viewer ─────────────────────────────────────────────────────

function XLSXViewer({ url, accentColor, branding, docName }: { url: string; accentColor: string; branding: RoomBranding; docName: string }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to fetch file')
        const buf = await res.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        if (cancelled) return
        setWorkbook(wb)
        setSheetNames(wb.SheetNames)
        setActiveSheet(0)
      } catch {
        if (!cancelled) setError('Failed to load spreadsheet')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [url])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 rounded-full animate-spin" style={{ borderTopColor: accentColor }} />
      </div>
    )
  }

  if (error || !workbook) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/50 text-sm">{error || 'No data'}</p>
      </div>
    )
  }

  const activeSheetName = sheetNames[activeSheet]
  const isCoverSheet = activeSheetName?.toLowerCase() === 'cover'

  const sheet = workbook.Sheets[activeSheetName]
  const data: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
  const headers = data[0] || []
  const rows = data.slice(1)

  // Derive a display title from the document name
  const displayTitle = docName
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/v\d+$/i, '')
    .trim()

  return (
    <div className="flex flex-col h-full">
      {/* Sheet tabs */}
      {sheetNames.length > 1 && (
        <div className="flex gap-0 border-b border-white/10 shrink-0 overflow-x-auto bg-white/[0.02]">
          {sheetNames.map((name, i) => (
            <button
              key={name}
              onClick={() => setActiveSheet(i)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                i === activeSheet
                  ? 'text-white bg-white/[0.05]'
                  : 'border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.03]'
              }`}
              style={i === activeSheet ? { borderBottomColor: accentColor } : undefined}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Cover sheet — branded splash page */}
      {isCoverSheet ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-lg">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-16 mx-auto mb-8 object-contain" />
            ) : (
              <div
                className="w-20 h-20 mx-auto mb-8 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: `${accentColor}15` }}
              >
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <path d="M8 13h8M8 17h8M8 9h2" />
                </svg>
              </div>
            )}
            <h2 className="text-2xl font-bold text-white mb-3">{displayTitle || 'Capitalization Table'}</h2>
            {branding.companyName && (
              <p className="text-base text-white/50 mb-6">{branding.companyName}</p>
            )}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
              <span className="text-sm text-white/40">
                {sheetNames.length - 1} {sheetNames.length - 1 === 1 ? 'sheet' : 'sheets'} available
              </span>
            </div>
            <p className="text-xs text-white/25 mt-8">
              Select a tab above to view data
            </p>
          </div>
        </div>
      ) : (
        /* Data table — high-contrast, larger text */
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-white/30 text-sm">Empty sheet</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className={`px-4 py-3 text-left font-semibold text-white bg-[#1a1a2e] border-b border-white/15 whitespace-nowrap ${
                        i === 0 ? 'sticky left-0 z-20 bg-[#1a1a2e]' : ''
                      }`}
                      style={i === 0 ? { borderLeft: `3px solid ${accentColor}` } : undefined}
                    >
                      {h != null ? String(h) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const stripeBg = ri % 2 === 0 ? 'bg-[#111120]' : 'bg-[#181830]'
                  return (
                    <tr key={ri} className={`${stripeBg} hover:bg-white/[0.12] transition-colors`}>
                      {headers.map((header, ci) => {
                        const cell = row[ci]
                        const isNum = typeof cell === 'number'
                        const headerStr = header != null ? String(header) : ''
                        return (
                          <td
                            key={ci}
                            className={`px-4 py-2.5 border-b border-white/5 whitespace-nowrap ${
                              ci === 0 ? `sticky left-0 z-[5] ${stripeBg}` : ''
                            } ${
                              isNum ? 'text-right text-white tabular-nums font-mono' : 'text-white'
                            }`}
                          >
                            {formatCellValue(cell, headerStr)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Doc Icon ────────────────────────────────────────────────────────

function DocIcon({ mime, large, filename }: { mime: string; large?: boolean; filename?: string }) {
  const size = large ? 'w-12 h-12' : 'w-4 h-4'

  if (isPdf(mime)) {
    return (
      <svg className={`${size} text-red-400 shrink-0`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 1.5h7l3 3V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2.5a1 1 0 011-1z" />
        <path d="M10 1.5V5h3" />
      </svg>
    )
  }

  if (isImage(mime)) {
    return (
      <svg className={`${size} text-blue-400 shrink-0`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="2" width="14" height="12" rx="1" />
        <circle cx="5" cy="6" r="1.5" />
        <path d="M15 11l-4-4-3 3-2-2-5 5" />
      </svg>
    )
  }

  if (isSpreadsheet(mime, filename || '')) {
    return (
      <svg className={`${size} text-emerald-400 shrink-0`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 1.5h7l3 3V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2.5a1 1 0 011-1z" />
        <path d="M10 1.5V5h3" />
        <path d="M5 8h6M5 10.5h6M8 7v5" />
      </svg>
    )
  }

  return (
    <svg className={`${size} text-white/40 shrink-0`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.5h7l3 3V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2.5a1 1 0 011-1z" />
      <path d="M10 1.5V5h3" />
    </svg>
  )
}
