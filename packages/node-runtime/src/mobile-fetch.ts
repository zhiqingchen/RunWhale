import fetch, { Blob, File, FormData, Headers, Request, Response } from 'node-fetch'
import { Readable } from 'node:stream'

/**
 * Node's bundled fetch currently initializes a WebAssembly HTTP parser. V8
 * intentionally removes WebAssembly in jitless mode, so use the pure-JS
 * node-fetch implementation for the embedded iOS runtime.
 */
export function installJitlessFetch(force = false): boolean {
  if (!force && typeof WebAssembly !== 'undefined') return false
  const globals = globalThis as Record<string, unknown>
  // isomorphic-git probes the Web CompressionStream API lazily. node-fetch's
  // Response cannot consume Node's Web ReadableStream, so that mixed path
  // serializes the stream as "[object ReadableStream]" and corrupts loose Git
  // objects. Its pako fallback is pure JavaScript and works in jitless Node.
  globals.CompressionStream = undefined
  globals.DecompressionStream = undefined
  globals.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await fetch(...args)
    const body = response.body
    if (body instanceof Readable) {
      // Anthropic and Google SDKs read SSE with the Web Streams API. Adapt lazily:
      // creating the bridge eagerly would consume JSON, image and Git response bodies.
      let webBody: ReturnType<typeof Readable.toWeb> | undefined
      Object.defineProperty(body, 'getReader', { value: () => (webBody ??= Readable.toWeb(body)).getReader() })
    }
    return response
  }
  globals.Headers = Headers
  globals.Request = Request
  globals.Response = Response
  globals.FormData = FormData
  globals.Blob = Blob
  globals.File = File
  return true
}
