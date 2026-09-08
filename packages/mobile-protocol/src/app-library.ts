import type { PreviewPlatform } from './types.js'
export interface LibraryApp {
  appId: string
  versionId: string
  name: string
  platform: PreviewPlatform
  sha256: string
  installedAt: number
  temporary: boolean
  expiresAt?: number
}
export interface ReleaseTransfer {
  id: string
  bytes: number
  sha256: string
}
export interface LibraryInstallInput {
  appId: string
  versionId: string
  name: string
  platform: PreviewPlatform
  sha256: string
  bytes: number
  temporary?: boolean
  expiresAt?: number
}
