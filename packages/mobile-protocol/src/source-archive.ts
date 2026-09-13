export interface SourceAttribution {
  creator: string
  license: string
  projectUrl?: string
}

export interface SourceArchiveMetadata {
  format: 'runwhale-source-v1'
  attribution: SourceAttribution
}

export interface SourceImportInput {
  name: string
  bytes: number
  sha256: string
}

export const SOURCE_ARCHIVE_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  entries: 10_000,
  chunkBytes: 48_000,
} as const
