export interface NativePreviewDiagnosticSummary {
  message: string
  stage?: string
  code?: string
}

export function nativePreviewDiagnosticSummary(value: string | undefined): NativePreviewDiagnosticSummary | undefined {
  if (!value?.trim()) return undefined
  try {
    const data = asRecord(JSON.parse(value) as unknown)
    if (typeof data.message === 'string' && data.message.trim()) {
      const stage = diagnosticLabel(data.stage)
      const code = diagnosticLabel(data.code)
      return {
        message: sanitizeDiagnosticMessage(data.message),
        ...(stage ? { stage } : {}),
        ...(code ? { code } : {}),
      }
    }
  } catch { /* older native hosts reported a plain diagnostic string */ }
  return { message: sanitizeDiagnosticMessage(value) }
}

/** Keep every Preview failure available for the user to hand off to the Agent. */
export function previewRepairMessage(value: string | undefined): string | undefined {
  const diagnostic = nativePreviewDiagnosticSummary(value)
  if (!diagnostic) return undefined
  return diagnostic.code ? `${diagnostic.code}: ${diagnostic.message}` : diagnostic.message
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function diagnosticLabel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : undefined
}

function sanitizeDiagnosticMessage(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s\"'<>]+/gi, '<redacted-url>')
    .replace(/\b(authorization\s*[=:]\s*(?:bearer\s+)?|(?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;\"']+/gi, '$1<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_048)
}
