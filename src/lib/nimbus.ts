import { randomUUID } from 'crypto'
import { z } from 'zod'

const envSchema = z.object({
  NIMBUS_BUY_BETTER_BASE_URL: z.string().url().optional(),
  NIMBUS_BUY_BETTER_API_TOKEN: z.string().min(1).optional(),
})

const env = envSchema.parse({
  NIMBUS_BUY_BETTER_BASE_URL: process.env.NIMBUS_BUY_BETTER_BASE_URL,
  NIMBUS_BUY_BETTER_API_TOKEN: process.env.NIMBUS_BUY_BETTER_API_TOKEN,
})

const statusResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  status: z.string(),
  projectId: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
})

const samResponseSchema = z.object({
  ok: z.boolean(),
  mode: z.string(),
  saved: z.boolean(),
  runId: z.string(),
  reportId: z.string().optional(),
  summary: z.string(),
  report: z.record(z.string(), z.unknown()),
})

const angelaRecommendationSchema = z.object({
  recommendationId: z.string(),
  funnelSlug: z.string(),
  hypothesis: z.string(),
  proposedChange: z.string(),
  expectedImpact: z.string(),
  confidence: z.string(),
  requiresReview: z.boolean(),
  strategyDependent: z.boolean(),
  category: z.string(),
  reasoningSummary: z.string(),
})

const angelaResponseSchema = z.object({
  ok: z.boolean(),
  mode: z.string(),
  saved: z.boolean(),
  runId: z.string(),
  recommendationSetId: z.string().optional(),
  summary: z.string(),
  recommendationSet: z.object({
    recommendations: z.array(angelaRecommendationSchema),
  }).and(z.record(z.string(), z.unknown())),
  sourceReport: z.record(z.string(), z.unknown()),
})

export type NimbusStatusResponse = z.infer<typeof statusResponseSchema>
export type NimbusSamResponse = z.infer<typeof samResponseSchema>
export type NimbusAngelaResponse = z.infer<typeof angelaResponseSchema>
export type NimbusAngelaRecommendation = z.infer<typeof angelaRecommendationSchema>

export function getNimbusConfig() {
  return {
    baseUrl: env.NIMBUS_BUY_BETTER_BASE_URL || '',
    hasToken: Boolean(env.NIMBUS_BUY_BETTER_API_TOKEN),
    configured: Boolean(env.NIMBUS_BUY_BETTER_BASE_URL && env.NIMBUS_BUY_BETTER_API_TOKEN),
  }
}

function getRequiredConfig() {
  if (!env.NIMBUS_BUY_BETTER_BASE_URL || !env.NIMBUS_BUY_BETTER_API_TOKEN) {
    throw new Error('Nimbus Buy Better integration is not configured')
  }

  return {
    baseUrl: env.NIMBUS_BUY_BETTER_BASE_URL.replace(/\/$/, ''),
    token: env.NIMBUS_BUY_BETTER_API_TOKEN,
  }
}

async function requestJson<T>(path: string, init: RequestInit, schema: z.ZodSchema<T>) {
  const { baseUrl, token } = getRequiredConfig()
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-nimbus-agent-token': token,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const message = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
      ? json.error
      : `Nimbus request failed with status ${response.status}`
    throw new Error(message)
  }

  return schema.parse(json)
}

export async function getNimbusStatus() {
  const { baseUrl, token } = getRequiredConfig()
  const response = await fetch(`${baseUrl}/api/agents/status`, {
    method: 'GET',
    headers: {
      'x-nimbus-agent-token': token,
    },
    cache: 'no-store',
  })

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const message = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
      ? json.error
      : `Nimbus status failed with status ${response.status}`
    throw new Error(message)
  }

  return statusResponseSchema.parse(json)
}

export async function runNimbusSam(input: { days?: number; mode?: 'preview-only' | 'manual-promote' }) {
  return requestJson(
    '/api/agents/sam/report',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    samResponseSchema,
  )
}

export async function runNimbusAngela(input: { days?: number; mode?: 'preview-only' | 'manual-promote'; funnelSlug?: string }) {
  return requestJson(
    '/api/agents/angela/recommend',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    angelaResponseSchema,
  )
}

export function createNimbusIntegrationId() {
  return randomUUID()
}
