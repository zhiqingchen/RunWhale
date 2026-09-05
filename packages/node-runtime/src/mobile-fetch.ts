import fetch, { Blob, File, FormData, Headers, Request, Response } from 'node-fetch'

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
  globals.fetch = fetch
  globals.Headers = Headers
  globals.Request = Request
  globals.Response = Response
  globals.FormData = FormData
  globals.Blob = Blob
  globals.File = File
  return true
}
