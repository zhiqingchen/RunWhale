export const MOBILE_IMAGE_MODEL = 'gpt-image-2'
export const MOBILE_IMAGE_SIZES = ['816x816', '1024x768', '768x1024', '1024x1024', '1536x1024', '1024x1536'] as const
export type MobileImageSize = typeof MOBILE_IMAGE_SIZES[number]

export interface ModelImageRequest {
  prompt: string
  projectIcon: boolean
  size?: MobileImageSize
  references: readonly { data: Uint8Array; mediaType: string }[]
  signal: AbortSignal
}

/** The agent chooses the prompt; the configured provider's Images API creates the asset. */
export async function generateModelImage(
  configuration: { baseURL?: string | undefined; apiKey: string },
  request: ModelImageRequest,
): Promise<Uint8Array> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5 * 60_000)])
  const base = new URL(configuration.baseURL ?? 'https://api.openai.com/v1')
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid image generation endpoint')
  const prefix = base.pathname.replace(/\/$/, '') || '/v1'
  base.pathname = `${prefix}/images/${request.references.length ? 'edits' : 'generations'}`
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(base, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${configuration.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MOBILE_IMAGE_MODEL,
        prompt: request.prompt,
        size: request.projectIcon ? '816x816' : request.size ?? '816x816',
        quality: request.projectIcon ? 'low' : 'medium',
        output_format: 'png',
        ...(request.projectIcon ? { background: 'opaque' } : {}),
        ...(request.references.length ? { images: request.references.map((image) => ({
          image_url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`,
        })) } : {}),
      }),
    })
  } catch {
    signal.throwIfAborted()
    throw new Error('Image generation request failed. Check the configured provider connection; no automatic retry was made.')
  }
  if (!response.ok) {
    // Provider bodies can echo credentials or private gateway diagnostics.
    throw new Error(`Image generation failed (HTTP ${response.status}). Check that the provider supports gpt-image-2 and that this API key/account group has image generation enabled.`)
  }
  let value: { data?: Array<{ b64_json?: string; url?: string }> }
  try { value = JSON.parse((await readBoundedBody(response, signal, 8 * 1024 * 1024)).toString('utf8')) } catch (error) {
    signal.throwIfAborted()
    if (error instanceof SyntaxError) throw new Error('Image generation returned invalid JSON')
    throw error
  }
  const image = value.data?.[0]
  if (typeof image?.b64_json === 'string' && image.b64_json.length) return Buffer.from(image.b64_json, 'base64')
  if (typeof image?.url !== 'string') throw new Error('The provider returned no generated image')
  const imageUrl = new URL(image.url)
  if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password) throw new Error('The provider returned an invalid image URL')
  // Gateway URL results are downloaded without forwarding the API credential.
  let download: Response
  try { download = await fetch(imageUrl, { signal, redirect: 'error' }) } catch {
    signal.throwIfAborted()
    throw new Error('Could not download the generated image; no new generation was requested')
  }
  if (!download.ok) throw new Error(`Generated image download failed (HTTP ${download.status})`)
  return readBoundedBody(download, signal, 5 * 1024 * 1024)
}

async function readBoundedBody(response: Response, signal: AbortSignal, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  if (!response.body) throw new Error('Image generation returned an empty response')
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    signal.throwIfAborted()
    bytes += chunk.byteLength
    if (bytes > limit) throw new Error('Generated image response exceeds the mobile size limit')
    chunks.push(chunk)
  }
  signal.throwIfAborted()
  return Buffer.concat(chunks)
}
