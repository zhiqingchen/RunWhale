import { describe, expect, it } from 'vitest'
import { isMobilePermissionMode } from '@runwhale/mobile-protocol'
import { permissionModeChangeRequiresConfirmation, permissionModeDescriptionKeys } from '../src/utils/permission-mode.js'

describe('mobile permission mode', () => {
  it('persists and restores the Full access protocol value', () => {
    const serialized = JSON.stringify({ permissionMode: 'danger-full-access' })
    const stored = JSON.parse(serialized) as { permissionMode?: unknown }
    expect(isMobilePermissionMode(stored.permissionMode)).toBe(true)
    expect(stored.permissionMode).toBe('danger-full-access')
  })

  it('requires confirmation only when Full access is newly enabled', () => {
    expect(permissionModeChangeRequiresConfirmation('review', 'danger-full-access')).toBe(true)
    expect(permissionModeChangeRequiresConfirmation('read-only', 'danger-full-access')).toBe(true)
    expect(permissionModeChangeRequiresConfirmation('danger-full-access', 'danger-full-access')).toBe(false)
    expect(permissionModeChangeRequiresConfirmation('danger-full-access', 'review')).toBe(false)
  })

  it('maps every protocol mode to its localized scope description', () => {
    expect(permissionModeDescriptionKeys).toEqual({
      review: 'reviewPermissionDescription',
      'read-only': 'readOnlyPermissionDescription',
      'danger-full-access': 'fullAccessPermissionDescription',
    })
  })
})
