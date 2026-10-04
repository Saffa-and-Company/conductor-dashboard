import { z } from 'zod'

export const createRoomSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  branding: z.object({
    companyName: z.string().max(200).optional(),
    tagline: z.string().max(500).optional(),
    logoUrl: z.string().max(2000).optional(),
    primaryColor: z.string().max(20).optional(),
    accentColor: z.string().max(20).optional(),
  }).optional(),
})

export const updateRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  branding: z.object({
    companyName: z.string().max(200).optional(),
    tagline: z.string().max(500).optional(),
    logoUrl: z.string().max(2000).optional(),
    primaryColor: z.string().max(20).optional(),
    accentColor: z.string().max(20).optional(),
  }).optional(),
})

export const updateDocumentSchema = z.object({
  folder: z.string().max(200).optional(),
  sort_order: z.number().int().min(0).optional(),
  allow_download: z.boolean().optional(),
})

export const createLinkSchema = z.object({
  name: z.string().max(200).optional(),
  passcode: z.string().min(4).max(50).optional(),
  allow_download: z.boolean().optional(),
  expires_at: z.number().int().positive().optional(),
})

export const updateLinkSchema = z.object({
  name: z.string().max(200).optional(),
  is_active: z.boolean().optional(),
  passcode: z.string().min(4).max(50).nullable().optional(),
  allow_download: z.boolean().optional(),
  expires_at: z.number().int().positive().nullable().optional(),
})

export const enterRoomSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().max(200).optional().default(''),
  company: z.string().max(200).optional().default(''),
  passcode: z.string().max(50).optional(),
})

export const recordEventSchema = z.object({
  document_id: z.number().int().positive(),
  event_type: z.enum(['doc_viewed', 'doc_downloaded', 'page_viewed']),
  page_number: z.number().int().min(1).optional(),
  duration_seconds: z.number().min(0).max(3600).optional(),
})
