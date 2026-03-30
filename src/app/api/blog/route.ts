import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'

const createBlogPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  content: z.string().default(''),
  excerpt: z.string().max(1000).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  tags: z.array(z.string()).default([]),
  cover_image_url: z.string().url().optional().or(z.literal('')),
})

function mapBlogPostRow(row: any) {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }
}

/**
 * GET /api/blog - List blog posts with optional filtering
 * Query params: status, author, search, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status')
    const author = searchParams.get('author')
    const search = searchParams.get('search')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = 'SELECT * FROM blog_posts WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    if (author) {
      query += ' AND author = ?'
      params.push(author)
    }
    if (search) {
      query += ' AND (title LIKE ? OR content LIKE ?)'
      const term = `%${search}%`
      params.push(term, term)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const posts = db.prepare(query).all(...params).map(mapBlogPostRow)

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM blog_posts WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (status) {
      countQuery += ' AND status = ?'
      countParams.push(status)
    }
    if (author) {
      countQuery += ' AND author = ?'
      countParams.push(author)
    }
    if (search) {
      countQuery += ' AND (title LIKE ? OR content LIKE ?)'
      const term = `%${search}%`
      countParams.push(term, term)
    }

    const { count } = db.prepare(countQuery).get(...countParams) as { count: number }

    return NextResponse.json({ posts, total: count })
  } catch (error) {
    logger.error({ err: error }, 'Failed to list blog posts')
    return NextResponse.json({ error: 'Failed to list blog posts' }, { status: 500 })
  }
}

/**
 * POST /api/blog - Create a new blog post
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitResult = mutationLimiter.check(request)
  if (limitResult) return limitResult

  const validation = await validateBody(request, createBlogPostSchema)
  if ('error' in validation) return validation.error

  const { data } = validation

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const author = auth.user.display_name || auth.user.username
    const now = Math.floor(Date.now() / 1000)
    const publishedAt = data.status === 'published' ? now : null

    // Check slug uniqueness
    const existing = db.prepare(
      'SELECT id FROM blog_posts WHERE slug = ? AND workspace_id = ?'
    ).get(data.slug, workspaceId)
    if (existing) {
      return NextResponse.json({ error: 'A blog post with this slug already exists' }, { status: 409 })
    }

    const result = db.prepare(`
      INSERT INTO blog_posts (title, slug, content, excerpt, author, status, tags, cover_image_url, published_at, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.title,
      data.slug,
      data.content,
      data.excerpt || null,
      author,
      data.status,
      JSON.stringify(data.tags),
      data.cover_image_url || null,
      publishedAt,
      workspaceId,
      now,
      now,
    )

    const post = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(result.lastInsertRowid)

    db_helpers.logActivity('blog_post_created', 'blog_post', Number(result.lastInsertRowid), author, `Created blog post: ${data.title}`, { slug: data.slug, status: data.status }, workspaceId)
    eventBus.broadcast('blog.created', mapBlogPostRow(post))

    return NextResponse.json({ post: mapBlogPostRow(post) }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'Failed to create blog post')
    return NextResponse.json({ error: 'Failed to create blog post' }, { status: 500 })
  }
}
