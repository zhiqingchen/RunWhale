import { z } from 'zod'
import type { PreviewPlatform, RuntimePlatform } from '@runwhale/mobile-protocol'

export const RUNWHALE_SCHEMA_VERSION = 1 as const
export const RUNTIME_ABI = {
  android: 'runwhale-expo57-android-v1',
  ios: 'runwhale-expo57-ios-v1',
} as const

const taskSchema = z.object({
  entry: z.string().min(1),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
}).strict()

export const runWhaleManifestSchema = z.object({
  schemaVersion: z.literal(RUNWHALE_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(80),
  runtimeAbi: z.object({
    android: z.literal(RUNTIME_ABI.android).optional(),
    ios: z.literal(RUNTIME_ABI.ios).optional(),
  }).strict().default({}),
  entry: z.object({
    web: z.string().min(1).optional(),
    ios: z.string().min(1).optional(),
    android: z.string().min(1).optional(),
  }).strict().default({}),
  preview: z.object({
    target: z.enum(['web', 'native']),
  }).strict().optional(),
  capabilities: z.array(z.enum(['network', 'storage', 'haptics'])).default([]),
  tasks: z.record(z.string(), taskSchema).default({}),
  source: z.object({
    kind: z.enum(['local', 'github', 'git', 'import']),
    url: z.url().optional(),
    archive: z.string().min(1).optional(),
    importedAt: z.number().int().positive().optional(),
    commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  if (manifest.preview?.target === 'web' && !manifest.entry.web) {
    context.addIssue({ code: 'custom', path: ['preview', 'target'], message: 'Web Preview requires entry.web' })
  }
  if (manifest.preview?.target === 'native' && !manifest.entry.ios && !manifest.entry.android) {
    context.addIssue({ code: 'custom', path: ['preview', 'target'], message: 'Native Preview requires entry.ios or entry.android' })
  }
})

export type RunWhaleManifest = z.infer<typeof runWhaleManifestSchema>

export function parseRunWhaleManifest(input: unknown): RunWhaleManifest {
  return runWhaleManifestSchema.parse(input)
}

export function resolveProjectPreviewPlatform(manifest: RunWhaleManifest, runtimePlatform: RuntimePlatform): PreviewPlatform | undefined {
  const hasWeb = Boolean(manifest.entry.web)
  const hasNative = Boolean(manifest.entry[runtimePlatform])
  if (manifest.preview?.target === 'web') {
    if (!hasWeb) throw new Error('Project selects Web Preview but does not declare entry.web')
    return 'web'
  }
  if (manifest.preview?.target === 'native') {
    if (!hasNative) throw new Error(`Project selects Native Preview but does not declare entry.${runtimePlatform}`)
    return runtimePlatform
  }
  if (hasWeb && hasNative) {
    throw new Error('Project declares both Web and Native Preview entries; set preview.target in runwhale.json')
  }
  if (hasNative) return runtimePlatform
  if (hasWeb) return 'web'
  return undefined
}
