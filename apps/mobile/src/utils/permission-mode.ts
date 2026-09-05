import type { MobilePermissionMode } from '@runwhale/mobile-protocol'

export type PermissionModeDescriptionKey =
  | 'reviewPermissionDescription'
  | 'readOnlyPermissionDescription'
  | 'fullAccessPermissionDescription'

export const permissionModeDescriptionKeys = {
  review: 'reviewPermissionDescription',
  'read-only': 'readOnlyPermissionDescription',
  'danger-full-access': 'fullAccessPermissionDescription',
} as const satisfies Record<MobilePermissionMode, PermissionModeDescriptionKey>

export function isMobilePermissionMode(value: unknown): value is MobilePermissionMode {
  return value === 'review' || value === 'read-only' || value === 'danger-full-access'
}

export function permissionModeChangeRequiresConfirmation(current: MobilePermissionMode, next: MobilePermissionMode): boolean {
  return current !== 'danger-full-access' && next === 'danger-full-access'
}
