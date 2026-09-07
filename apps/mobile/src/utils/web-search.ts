export function webSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.replace(/^<|>$/g, ''))
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

export function webSearchSources(meta: unknown): Array<{ url: string; title: string }> {
  if (!meta || typeof meta !== 'object' || !('sources' in meta) || !Array.isArray(meta.sources)) return []
  const sources = new Map<string, { url: string; title: string }>()
  for (const item of meta.sources) {
    if (!item || typeof item !== 'object') continue
    const url = webSourceUrl(item.url)
    if (url) sources.set(url, { url, title: typeof item.title === 'string' && item.title ? item.title : new URL(url).hostname })
  }
  return [...sources.values()]
}

/** Preserve the provider's widget styling while isolating it from app data and scripts. */
export function googleSearchSuggestions(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object' || !('googleSearchSuggestions' in meta)) return undefined
  const html = meta.googleSearchSuggestions
  if (typeof html !== 'string' || !html.trim() || html.length > 64000) return undefined
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'none'; base-uri 'none'"></head><body style="margin:0">${html}</body></html>`
}
