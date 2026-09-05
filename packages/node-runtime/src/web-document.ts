import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, join, posix, relative, resolve, sep } from 'node:path'
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
export interface WebPreviewDocument {
  html: string
  assets: Record<string, { content: string; contentType: string }>
}
const prefix = '/__runwhale_assets__'
const maxHtmlBytes = 2 * 1024 * 1024
const maxAssetBytes = 16 * 1024 * 1024
const defaultHtml = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

export async function readWebDocument(root: string): Promise<WebPreviewDocument> {
  const assets: WebPreviewDocument['assets'] = {}
  let bytes = 0
  async function visit(directory: string, local: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue
      const path = join(directory, item.name)
      const name = `${local}/${item.name}`
      if (item.isDirectory()) await visit(path, name)
      else if (item.isFile() && contentTypes[extname(item.name)]) {
        const info = await stat(path)
        bytes += info.size
        if (bytes > maxAssetBytes) throw new Error('Web Preview assets exceed 16 MiB')
        const data = await readFile(path)
        assets[name] = { content: data.toString('base64'), contentType: contentTypes[extname(item.name)]! }
      }
    }
  }
  await visit(root, '')
  let html = defaultHtml
  try {
    const path = await confinedPath(root, 'index.html')
    if ((await stat(path)).size > maxHtmlBytes) throw new Error('Web Preview HTML exceeds 2 MiB')
    html = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { html, assets }
}

function assetUrl(value: string, base: string, token: string): string {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return value
  const url = new URL(value, `http://preview.invalid${base}`)
  url.pathname = prefix + url.pathname
  url.searchParams.set('token', token)
  return url.pathname + url.search + url.hash
}

export function renderWebCss(css: string, path: string, token: string): string {
  // Leave remote/data references untouched; local references retain their query
  // and fragment while receiving the same localhost request authentication.
  return css.replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)'"\n]+))\s*\)/gi,
    (_match, double, single, bare) => `url(${JSON.stringify(assetUrl(double ?? single ?? bare, path, token))})`)
    .replace(/(@import\s+)(["'])([^"'\n]+)\2/gi,
      (_match, keyword, _quote, value) => keyword + JSON.stringify(assetUrl(value, path, token)))
}

export function renderWebDocument(document: WebPreviewDocument | undefined, bundlePath: string, token: string): string {
  const tree = parse(document?.html ?? defaultHtml)
  let head: Element | undefined
  let body: Element | undefined
  const visit = (node: Node): void => {
    if ('tagName' in node) {
      if (node.tagName === 'head') head = node
      if (node.tagName === 'body') body = node
      for (const attribute of node.attrs) {
        if (['src', 'poster'].includes(attribute.name) || (node.tagName === 'link' && attribute.name === 'href')) attribute.value = assetUrl(attribute.value, '/', token)
        if (attribute.name === 'style') attribute.value = renderWebCss(attribute.value, '/', token)
      }
      if (node.tagName === 'style') for (const child of node.childNodes) {
        if ('value' in child) child.value = renderWebCss(child.value, '/', token)
      }
    }
    if ('childNodes' in node) {
      // The manifest owns the executable entry. Retain the HTML document's
      // styles, metadata and markup without loading its raw TS/Vite script too.
      node.childNodes = node.childNodes.filter((child) => !replacedHtmlElement(child))
      for (const child of node.childNodes) visit(child)
    }
  }
  visit(tree)
  const append = (parent: Element, html: string, first = false) => {
    const fragment = parseFragment(html)
    for (const node of fragment.childNodes) node.parentNode = parent
    if (first) parent.childNodes.unshift(...fragment.childNodes)
    else parent.childNodes.push(...fragment.childNodes)
  }
  if (head) {
    append(head, '<style>html,body,#root{height:100%;margin:0}body{box-sizing:border-box;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}</style>', true)
    append(head, '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">')
  }
  if (body) append(body, `<script src="${bundlePath.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></script>`)
  return serialize(tree)
}

function replacedHtmlElement(node: Node): boolean {
  if (!('tagName' in node)) return false
  if (node.tagName === 'script' || node.tagName === 'base') return true
  return node.tagName === 'meta' && node.attrs.some((attribute) =>
    ['http-equiv', 'name'].includes(attribute.name)
    && ['content-security-policy', 'refresh', 'viewport', 'referrer'].includes(attribute.value.toLowerCase()))
}

function assetPath(pathname: string): string | undefined {
  if (!isWebAssetPath(pathname)) return undefined
  let name: string
  try {
    name = decodeURIComponent(pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length) : pathname)
  } catch { return undefined }
  if (name.includes('\\') || name.split('/').some((part) => part.startsWith('.') || part === 'node_modules') || posix.normalize(name) !== name) return undefined
  return name
}

export function webAsset(document: WebPreviewDocument | undefined, pathname: string) {
  const name = assetPath(pathname)
  if (!document || !name) return undefined
  const asset = document.assets[name] ?? document.assets['/public' + name]
  return asset ? { ...asset, path: name } : undefined
}

async function confinedPath(root: string, path: string): Promise<string> {
  const canonicalRoot = await realpath(root)
  const target = await realpath(resolve(root, path))
  const local = relative(canonicalRoot, target)
  if (local === '..' || local.startsWith(`..${sep}`) || local.startsWith(sep)) throw new Error('Web asset escapes project root')
  return target
}

export async function readLiveWebAsset(root: string, pathname: string) {
  const name = assetPath(pathname)
  if (!name) return undefined
  const contentType = contentTypes[extname(name)]
  if (!contentType) return undefined
  for (const candidate of [name.slice(1), 'public' + name]) {
    try {
      const path = await confinedPath(root, candidate)
      const info = await stat(path)
      if (!info.isFile() || info.size > maxAssetBytes) return undefined
      return { path: name, contentType, content: (await readFile(path)).toString('base64') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
  }
  return undefined
}

export function isWebAssetPath(pathname: string): boolean {
  return pathname.startsWith(prefix + '/') || Boolean(contentTypes[extname(pathname)])
}
