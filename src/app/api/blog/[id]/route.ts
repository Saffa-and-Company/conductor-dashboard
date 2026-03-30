import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'

const updateBlogPostSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  content: z.string().optional(),
  excerpt: z.string().max(1000).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: z.array(z.string()).optional(),
  cover_image_url: z.string().url().optional().nullable().or(z.literal('')),
})

function mapBlogPostRow(row: any) {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }
}

/**
 * GET /api/blog/[id] - Get a specific blog post
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id

    const post = db.prepare(
      'SELECT * FROM blog_posts WHERE id = ? AND workspace_id = ?'
    ).get(parseInt(id), workspaceId)

    if (!post) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 })
    }

    return NextResponse.json({ post: mapBlogPostRow(post) })
  } catch (error) {
    logger.error({ err: error }, 'Failed to get blog post')
    return NextResponse.json({ error: 'Failed to get blog post' }, { status: 500 })
  }
}

/**
 * PATCH /api/blog/[id] - Update a blog post
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitResult = mutationLimiter.check(request)
  if (limitResult) return limitResult

  const validation = await validateBody(request, updateBlogPostSchema)
  if ('error' in validation) return validation.error

  const { data } = validation

  try {
    const { id } = await params
    const postId = parseInt(id)
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const actor = auth.user.display_name || auth.user.username

    const existing = db.prepare(
      'SELECT * FROM blog_posts WHERE id = ? AND workspace_id = ?'
    ).get(postId, workspaceId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 })
    }

    // Check slug uniqueness if changing
    if (data.slug && data.slug !== existing.slug) {
      const slugConflict = db.prepare(
        'SELECT id FROM blog_posts WHERE slug = ? AND workspace_id = ? AND id != ?'
      ).get(data.slug, workspaceId, postId)
      if (slugConflict) {
        return NextResponse.json({ error: 'A blog post with this slug already exists' }, { status: 409 })
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const sets: string[] = ['updated_at = ?']
    const values: any[] = [now]

    if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title) }
    if (data.slug !== undefined) { sets.push('slug = ?'); values.push(data.slug) }
    if (data.content !== undefined) { sets.push('content = ?'); values.push(data.content) }
    if (data.excerpt !== undefined) { sets.push('excerpt = ?'); values.push(data.excerpt) }
    if (data.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(data.tags)) }
    if (data.cover_image_url !== undefined) { sets.push('cover_image_url = ?'); values.push(data.cover_image_url || null) }

    if (data.status !== undefined) {
      sets.push('status = ?')
      values.push(data.status)
      // Set published_at when first published
      if (data.status === 'published' && !existing.published_at) {
        sets.push('published_at = ?')
        values.push(now)
      }
    }

    values.push(postId, workspaceId)

    db.prepare(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values)

    const updated = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(postId)

    db_helpers.logActivity('blog_post_updated', 'blog_post', postId, actor, `Updated blog post: ${existing.title}`, { changes: Object.keys(data) }, workspaceId)
    eventBus.broadcast('blog.updated', mapBlogPostRow(updated))

    return NextResponse.json({ post: mapBlogPostRow(updated) })
  } catch (error) {
    logger.error({ err: error }, 'Failed to update blog post')
    return NextResponse.json({ error: 'Failed to update blog post' }, { status: 500 })
  }
}

/**
 * DELETE /api/blog/[id] - Delete a blog post
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitResult = mutationLimiter.check(request)
  if (limitResult) return limitResult

  try {
    const { id } = await params
    const postId = parseInt(id)
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const actor = auth.user.display_name || auth.user.username

    const existing = db.prepare(
      'SELECT * FROM blog_posts WHERE id = ? AND workspace_id = ?'
    ).get(postId, workspaceId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 })
    }

    db.prepare('DELETE FROM blog_posts WHERE id = ? AND workspace_id = ?').run(postId, workspaceId)

    db_helpers.logActivity('blog_post_deleted', 'blog_post', postId, actor, `Deleted blog post: ${existing.title}`, null, workspaceId)
    eventBus.broadcast('blog.deleted', { id: postId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete blog post')
    return NextResponse.json({ error: 'Failed to delete blog post' }, { status: 500 })
  }
}
