'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMissionControl, BlogPost } from '@/store'
import { MarkdownRenderer } from '@/components/markdown-renderer'

type ViewMode = 'list' | 'editor' | 'preview'

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  published: 'bg-green-500/15 text-green-400 border-green-500/30',
  archived: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

export function BlogPortalPanel() {
  const { currentUser, blogPosts, setBlogPosts, selectedBlogPost, setSelectedBlogPost, addBlogPost, updateBlogPost, deleteBlogPost } = useMissionControl()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  // Editor state
  const [editTitle, setEditTitle] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editExcerpt, setEditExcerpt] = useState('')
  const [editStatus, setEditStatus] = useState<'draft' | 'published' | 'archived'>('draft')
  const [editTags, setEditTags] = useState('')
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)

  const loadPosts = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('limit', '100')

      const res = await fetch(`/api/blog?${params}`)
      if (!res.ok) throw new Error('Failed to load blog posts')
      const data = await res.json()
      setBlogPosts(data.posts)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, searchQuery, setBlogPosts])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  function resetEditor(post?: BlogPost) {
    if (post) {
      setEditTitle(post.title)
      setEditSlug(post.slug)
      setEditContent(post.content)
      setEditExcerpt(post.excerpt || '')
      setEditStatus(post.status)
      setEditTags(post.tags.join(', '))
      setEditCoverUrl(post.cover_image_url || '')
      setSlugManuallyEdited(true)
    } else {
      setEditTitle('')
      setEditSlug('')
      setEditContent('')
      setEditExcerpt('')
      setEditStatus('draft')
      setEditTags('')
      setEditCoverUrl('')
      setSlugManuallyEdited(false)
    }
  }

  function handleNewPost() {
    setSelectedBlogPost(null)
    resetEditor()
    setViewMode('editor')
  }

  function handleEditPost(post: BlogPost) {
    setSelectedBlogPost(post)
    resetEditor(post)
    setViewMode('editor')
  }

  function handlePreviewPost(post: BlogPost) {
    setSelectedBlogPost(post)
    setViewMode('preview')
  }

  async function handleSave() {
    if (!editTitle.trim() || !editSlug.trim()) {
      setError('Title and slug are required')
      return
    }

    setSaving(true)
    setError(null)

    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const payload = {
      title: editTitle.trim(),
      slug: editSlug.trim(),
      content: editContent,
      excerpt: editExcerpt.trim() || undefined,
      status: editStatus,
      tags,
      cover_image_url: editCoverUrl.trim() || undefined,
    }

    try {
      if (selectedBlogPost) {
        const res = await fetch(`/api/blog/${selectedBlogPost.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update post')
        }
        const data = await res.json()
        updateBlogPost(selectedBlogPost.id, data.post)
        setSelectedBlogPost(data.post)
      } else {
        const res = await fetch('/api/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create post')
        }
        const data = await res.json()
        addBlogPost(data.post)
        setSelectedBlogPost(data.post)
      }
      setViewMode('list')
      loadPosts()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(postId: number) {
    try {
      const res = await fetch(`/api/blog/${postId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete post')
      deleteBlogPost(postId)
      setDeleteConfirm(null)
      if (selectedBlogPost?.id === postId) {
        setSelectedBlogPost(null)
        setViewMode('list')
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleTogglePublish(post: BlogPost) {
    const newStatus = post.status === 'published' ? 'draft' : 'published'
    try {
      const res = await fetch(`/api/blog/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update post status')
      const data = await res.json()
      updateBlogPost(post.id, data.post)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const isViewer = currentUser?.role === 'viewer'

  // List View
  if (viewMode === 'list') {
    return (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Buy Better Blog</h2>
            <p className="text-sm text-muted-foreground">Manage and publish blog content</p>
          </div>
          {!isViewer && (
            <button
              onClick={handleNewPost}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              New Post
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {/* Posts Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-sm">Loading posts...</span>
            </div>
          </div>
        ) : blogPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <svg className="w-12 h-12 mb-3 opacity-40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M3 1.5h7l3 3V14a1 1 0 01-1 1H3a1 1 0 01-1-1V2.5a1 1 0 011-1z" />
              <path d="M10 1.5V5h3" />
              <path d="M5 8h6M5 10.5h6M5 13h4" />
            </svg>
            <p className="text-sm font-medium">No blog posts yet</p>
            <p className="text-xs mt-1">Create your first post to get started</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {blogPosts.map((post) => (
              <div
                key={post.id}
                className="p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3
                        className="text-sm font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                        onClick={() => handlePreviewPost(post)}
                      >
                        {post.title}
                      </h3>
                      <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${STATUS_COLORS[post.status]}`}>
                        {post.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {post.excerpt || post.content.slice(0, 150) || 'No content'}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>By {post.author}</span>
                      <span>{formatDate(post.created_at)}</span>
                      {post.published_at && (
                        <span className="text-green-400">Published {formatDate(post.published_at)}</span>
                      )}
                      {post.tags.length > 0 && (
                        <div className="flex gap-1">
                          {post.tags.map((tag) => (
                            <span key={tag} className="px-1.5 py-0.5 bg-secondary rounded text-[10px]">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isViewer && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleTogglePublish(post)}
                        title={post.status === 'published' ? 'Unpublish' : 'Publish'}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        {post.status === 'published' ? (
                          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M2 2l12 12M13.5 10.5A6.5 6.5 0 005 3.5M1 8s2.5-5 7-5c.8 0 1.5.1 2.2.4M14.5 8s-1.2 2.5-3.5 3.8" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                            <circle cx="8" cy="8" r="2" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => handleEditPost(post)}
                        title="Edit"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 2l3 3-8 8H3v-3l8-8z" />
                        </svg>
                      </button>
                      {deleteConfirm === post.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(post.id)}
                            className="px-2 py-1 text-[10px] bg-destructive text-destructive-foreground rounded font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 text-[10px] bg-secondary text-foreground rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(post.id)}
                          title="Delete"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M3 4h10M6 4V2h4v2M5 4v9h6V4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Editor View
  if (viewMode === 'editor') {
    return (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode('list')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-foreground">
              {selectedBlogPost ? 'Edit Post' : 'New Post'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : selectedBlogPost ? 'Update' : 'Create'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {/* Editor Form */}
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          {/* Main content */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value)
                  if (!slugManuallyEdited) {
                    setEditSlug(generateSlug(e.target.value))
                  }
                }}
                placeholder="Post title"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Slug</label>
              <input
                type="text"
                value={editSlug}
                onChange={(e) => {
                  setEditSlug(e.target.value)
                  setSlugManuallyEdited(true)
                }}
                placeholder="post-url-slug"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Content (Markdown)</label>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Write your blog post content in Markdown..."
                rows={20}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Excerpt</label>
              <textarea
                value={editExcerpt}
                onChange={(e) => setEditExcerpt(e.target.value)}
                placeholder="Brief summary of the post..."
                rows={3}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="news, update, product"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Cover Image URL</label>
              <input
                type="text"
                value={editCoverUrl}
                onChange={(e) => setEditCoverUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Preview View
  if (viewMode === 'preview' && selectedBlogPost) {
    return (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode('list')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-foreground">Preview</h2>
          </div>
          {!isViewer && (
            <button
              onClick={() => handleEditPost(selectedBlogPost)}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Edit Post
            </button>
          )}
        </div>

        {/* Post Preview */}
        <article className="max-w-3xl mx-auto">
          {selectedBlogPost.cover_image_url && (
            <div className="mb-6 rounded-xl overflow-hidden border border-border">
              <img
                src={selectedBlogPost.cover_image_url}
                alt={selectedBlogPost.title}
                className="w-full h-48 object-cover"
              />
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${STATUS_COLORS[selectedBlogPost.status]}`}>
              {selectedBlogPost.status}
            </span>
            {selectedBlogPost.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-secondary rounded text-[10px] text-muted-foreground">{tag}</span>
            ))}
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">{selectedBlogPost.title}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-6">
            <span>By {selectedBlogPost.author}</span>
            <span>Created {formatDate(selectedBlogPost.created_at)}</span>
            {selectedBlogPost.published_at && (
              <span>Published {formatDate(selectedBlogPost.published_at)}</span>
            )}
          </div>
          {selectedBlogPost.excerpt && (
            <p className="text-muted-foreground italic mb-6 pb-6 border-b border-border">{selectedBlogPost.excerpt}</p>
          )}
          <div className="prose prose-invert max-w-none">
            <MarkdownRenderer content={selectedBlogPost.content || '*No content yet*'} />
          </div>
        </article>
      </div>
    )
  }

  return null
}
