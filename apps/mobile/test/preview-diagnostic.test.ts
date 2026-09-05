import { describe, expect, it } from 'vitest'
import {
  nativePreviewDiagnosticSummary,
  previewRepairMessage,
} from '../src/utils/preview-diagnostic'

describe('Native Preview diagnostic summary', () => {
  it('extracts structured stage diagnostics without exposing the source URL', () => {
    expect(nativePreviewDiagnosticSummary(JSON.stringify({
      stage: 'content-mount',
      code: 'content_mount_timeout',
      message: 'Failed at http://127.0.0.1:31337/index.bundle?token=private-token',
    }))).toEqual({
      stage: 'content-mount',
      code: 'content_mount_timeout',
      message: 'Failed at <redacted-url>',
    })
  })

  it('supports legacy plain diagnostics and redacts secret values', () => {
    expect(nativePreviewDiagnosticSummary('authorization=private-value failed')).toEqual({
      message: 'authorization=<redacted> failed',
    })
  })

  it('offers repair for manifest and Metro errors with their source location', () => {
    for (const message of [
      'Project does not contain runwhale.json',
      'Project selects Native Preview but does not declare entry.ios',
      'SyntaxError: /projects/game/app/index.tsx:19:7 Unexpected token',
      'Unable to resolve module ./missing from app/index.tsx',
    ]) expect(previewRepairMessage(message)).toBe(message)
  })

  it('preserves native JavaScript error codes and redacts repair context', () => {
    for (const code of ['javascript_fatal', 'runtime_exception']) {
      expect(previewRepairMessage(JSON.stringify({
        code,
        message: 'TypeError at http://127.0.0.1:31337/index.bundle?token=private-token authorization=Bearer raw-secret',
      }))).toBe(`${code}: TypeError at <redacted-url> authorization=Bearer <redacted>`)
    }
  })

  it('offers repair for plain animation failures without a JavaScript error name', () => {
    const message = 'Attempting to run JS driven animation on an animated node that has been moved to "native" earlier by starting an animation with `useNativeDriver: true`'
    expect(previewRepairMessage(message)).toBe(message)
  })

  it('keeps host and connection failures available for Agent diagnosis', () => {
    for (const message of ['Runtime is not running', 'TypeError: Network request failed', 'Native Preview is unavailable in the desktop UI']) {
      expect(previewRepairMessage(message)).toBe(message)
    }
    expect(previewRepairMessage(JSON.stringify({ code: 'presenter_unavailable', message: 'Native Preview could not open' })))
      .toBe('presenter_unavailable: Native Preview could not open')
  })

  it('omits empty failures', () => {
    for (const message of [undefined, '', '   ']) {
      expect(previewRepairMessage(message)).toBeUndefined()
    }
  })
})
