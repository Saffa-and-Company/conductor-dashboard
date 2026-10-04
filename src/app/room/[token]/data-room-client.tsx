'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as XLSX from 'xlsx'

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
}

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

  const primaryColor = branding.primaryColor || '#0f172a'
  const accentColor = branding.accentColor || '#3b82f6'

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

  const accentColor = branding.accentColor || '#3b82f6'

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0f1724] to-[#0a0a0f]" />

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
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {submitting ? 'Entering...' : 'View Documents'}
            </button>
          </form>

          <p className="text-[10px] text-white/20 text-center mt-6">
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
  const accentColor = branding.accentColor || '#3b82f6'

  // Group documents by folder
  const folders = documents.reduce<Record<string, RoomDoc[]>>((acc, doc) => {
    const folder = doc.folder || ''
    if (!acc[folder]) acc[folder] = []
    acc[folder].push(doc)
    return acc
  }, {})

  const handleDownload = (doc: RoomDoc) => {
    window.open(`/api/room/${token}/documents/${doc.id}/file?download=1`, '_blank')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-200 shrink-0 overflow-hidden`}>
        <div className="w-72 h-full flex flex-col border-r border-white/10 bg-[#0c0c14]">
          {/* Header */}
          <div className="p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white truncate">
              {branding.companyName || 'Data Room'}
            </h2>
            {branding.tagline && (
              <p className="text-xs text-white/40 mt-0.5 truncate">{branding.tagline}</p>
            )}
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto p-2">
            {Object.entries(folders).map(([folder, docs]) => (
              <div key={folder}>
                {folder && (
                  <p className="text-[10px] tracking-wider text-white/30 font-semibold px-2 pt-3 pb-1 uppercase">
                    {folder}
                  </p>
                )}
                {docs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => onSelectDoc(doc)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-colors ${
                      selectedDoc?.id === doc.id
                        ? 'bg-white/10 text-white'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <DocIcon mime={doc.mime_type} filename={doc.original_name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{doc.original_name}</p>
                        <p className="text-[10px] text-white/30">{formatBytes(doc.file_size)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle sidebar */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute top-3 left-2 z-10 md:hidden w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/50 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>

      {/* Document content */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#0a0a0f]">
        {selectedDoc ? (
          <>
            {/* Document header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{selectedDoc.original_name}</p>
              </div>
              {selectedDoc.allow_download && (
                <button
                  onClick={() => handleDownload(selectedDoc)}
                  className="px-3 py-1.5 text-xs rounded-lg text-white transition-colors shrink-0 ml-2"
                  style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                >
                  Download
                </button>
              )}
            </div>

            {/* Document body */}
            <div className="flex-1 overflow-auto">
              {isPdf(selectedDoc.mime_type) ? (
                <PDFViewer
                  url={`/api/room/${token}/documents/${selectedDoc.id}/file`}
                  docId={selectedDoc.id}
                  token={token}
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
                        className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                        style={{ backgroundColor: accentColor }}
                      >
                        Download File
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            Select a document to view
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PDF Viewer ──────────────────────────────────────────────────────

function PDFViewer({ url, docId, token }: { url: string; docId: number; token: string }) {
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
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 bg-white/[0.02] border-b border-white/5 shrink-0">
        <span className="text-xs text-white/50">
          Page {currentPage} of {numPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            className="w-7 h-7 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            -
          </button>
          <span className="text-xs text-white/50 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.2))}
            className="w-7 h-7 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            +
          </button>
        </div>
      </div>

      {/* Pages */}
      <div ref={containerRef} className="flex-1 overflow-auto py-4">
        <div className="flex flex-col items-center gap-4">
          {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              data-page={pageNum}
              className="shadow-lg shadow-black/50"
            >
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNum, el)
                  else canvasRefs.current.delete(pageNum)
                }}
                className="block"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── XLSX Viewer ─────────────────────────────────────────────────────

function XLSXViewer({ url }: { url: string }) {
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
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
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

  const sheet = workbook.Sheets[sheetNames[activeSheet]]
  const data: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
  const headers = data[0] || []
  const rows = data.slice(1)

  return (
    <div className="flex flex-col h-full">
      {/* Sheet tabs */}
      {sheetNames.length > 1 && (
        <div className="flex gap-0 border-b border-white/10 shrink-0 overflow-x-auto bg-white/[0.02]">
          {sheetNames.map((name, i) => (
            <button
              key={name}
              onClick={() => setActiveSheet(i)}
              className={`px-4 py-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                i === activeSheet
                  ? 'border-blue-400 text-white bg-white/[0.05]'
                  : 'border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.03]'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-white/30 text-sm">Empty sheet</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2.5 text-left font-semibold text-white/80 bg-[#151520] border-b border-white/10 whitespace-nowrap"
                  >
                    {h != null ? String(h) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}>
                  {headers.map((_, ci) => {
                    const cell = row[ci]
                    const isNum = typeof cell === 'number'
                    return (
                      <td
                        key={ci}
                        className={`px-3 py-2 border-b border-white/5 whitespace-nowrap ${
                          isNum ? 'text-right text-white/70 tabular-nums' : 'text-white/60'
                        }`}
                      >
                        {cell != null ? String(cell) : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
