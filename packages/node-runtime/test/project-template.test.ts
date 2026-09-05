import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MobileMetroRuntime } from '../src/metro-runtime.js'
import { readPreviewArtifact, writePreviewArtifact } from '../src/preview-artifact.js'
import { MobileTypeScriptService } from '@runwhale/mobile-runtime'
// Load the actual Studio template without treating the app's bundler-mode source as NodeNext code.
const { projectTemplateFiles } = await import(resolve(import.meta.dirname, '../../../apps/mobile/src/state/project-data.ts')) as {
  projectTemplateFiles(id: string, name: string, template: 'web' | 'expo'): { path: string; content: string }[]
}

const moduleStore = resolve(process.env.RUNWHALE_TEST_MODULE_STORE ?? join(import.meta.dirname, '../../runtime-module-store/node_modules'))

describe('actual project templates', () => {
  it.each(['web', 'expo'] as const)('%s passes first diagnostics without project node_modules and still reports real errors', async (template) => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-template-types-'))
    try {
      const files = projectTemplateFiles('template-check', 'Template check', template)
      for (const file of files) {
        await mkdir(dirname(join(root, file.path)), { recursive: true })
        await writeFile(join(root, file.path), file.content)
      }
      const path = template === 'web' ? 'src/main.tsx' : 'index.tsx'
      const source = files.find((file) => file.path === path)!.content
      let service = new MobileTypeScriptService([{ path, content: source }], { root, moduleStore })
      try { expect(service.diagnostics(path).filter((item) => item.category === 'error')).toEqual([]) } finally { service.dispose() }
      await writeFile(join(root, 'score.ts'), 'export const score: number = 7\n')
      const content = source + `\nimport { score } from '${template === 'web' ? '../' : './'}score'\nconst wrong: string = score\n`
      service = new MobileTypeScriptService([{ path, content }], { root, moduleStore })
      try {
        expect(service.diagnostics(path).filter((item) => item.category === 'error').map((item) => item.code)).toEqual([2322])
      } finally { service.dispose() }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('Web template Preview', () => {
  it('loads ordinary CSS, project HTML and authenticated assets, updates styles, and restores the saved document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-template-preview-'))
    const metro = new MobileMetroRuntime(moduleStore, [resolve(import.meta.dirname, '../../../node_modules/.pnpm')])
    try {
      for (const file of projectTemplateFiles('template-check', 'Template check', 'web')) {
        await mkdir(dirname(join(root, file.path)), { recursive: true })
        await writeFile(join(root, file.path), file.content)
      }
      await mkdir(join(root, 'public'))
      await mkdir(join(root, 'node_modules'))
      await writeFile(join(root, 'node_modules/private.css'), 'body { color: red; }')
      await writeFile(join(root, 'public/fish.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>Fish</title></svg>')
      await writeFile(join(root, 'src/palette.css'), 'body { color: teal; }')
      await writeFile(join(root, 'src/styles.css'), '@import "./palette.css"; .app { background-image: url("/fish.svg"); color: coral; }')
      await writeFile(join(root, 'index.html'), '<!doctype html><html lang="en"><head><title>Ocean game</title><style>body { background: aqua; }</style></head><body><img src="/fish.svg"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
      const bundle = await metro.bundle(root, 'web')
      expect(bundle.code).toContain('runwhale-css-')
      const serving = await metro.serve(bundle)
      const page = new URL('/', serving.bundleUrl)
      page.searchParams.set('token', serving.token)
      const html = await (await fetch(page)).text()
      expect(html).toContain('<title>Ocean game</title>')
      expect(html).toContain('background: aqua')
      expect(html).toContain('viewport-fit=cover')
      expect(html).not.toContain('src="/src/main.tsx"')
      expect(html).toContain('/__runwhale_assets__/fish.svg?token=')
      const cssUrl = new URL('/__runwhale_assets__/src/styles.css', page)
      expect((await fetch(cssUrl)).status).toBe(401)
      cssUrl.search = page.search
      const css = await (await fetch(cssUrl)).text()
      expect(css).toContain('/__runwhale_assets__/src/palette.css?token=')
      expect(css).toContain('/__runwhale_assets__/fish.svg?token=')
      const imageUrl = new URL('/__runwhale_assets__/fish.svg', page)
      imageUrl.search = page.search
      expect((await fetch(imageUrl)).headers.get('content-type')).toBe('image/svg+xml')
      const jsxImageUrl = new URL('/fish.svg', page)
      expect((await fetch(jsxImageUrl)).status).toBe(401)
      expect((await fetch(jsxImageUrl, { headers: { referer: page.href } })).status).toBe(200)
      const foreignReferrer = new URL(page)
      foreignReferrer.port = '1'
      expect((await fetch(jsxImageUrl, { headers: { referer: foreignReferrer.href } })).status).toBe(401)
      expect((await fetch(new URL('/package.json', page), { headers: { referer: page.href } })).status).toBe(401)
      expect((await fetch(new URL('/node_modules/private.css', page), { headers: { referer: page.href } })).status).toBe(404)
      await writeFile(join(root, 'src/styles.css'), '.app { color: gold; }')
      expect(await (await fetch(cssUrl)).text()).toContain('color: gold')
      const updated = await metro.bundle(root, 'web')
      expect(updated.code).not.toBe(bundle.code)
      const key = { projectId: 'template-check', platform: 'web' as const, runtimeAbi: 'web-v1' }
      await writePreviewArtifact(root, key, updated, 2)
      const cached = await readPreviewArtifact(root, key)
      expect(cached?.webDocument).toEqual(updated.webDocument)
      await writeFile(join(root, 'index.html'), '<title>Unbuilt changes</title>')
      await writeFile(join(root, 'src/styles.css'), '.app { color: pink; }')
      const restored = await metro.serve(cached!, { live: false })
      const cachedPage = new URL('/', restored.bundleUrl)
      cachedPage.searchParams.set('token', restored.token)
      expect(await (await fetch(cachedPage)).text()).toContain('<title>Ocean game</title>')
      const cachedCss = new URL('/__runwhale_assets__/src/styles.css', cachedPage)
      cachedCss.search = cachedPage.search
      expect(await (await fetch(cachedCss)).text()).toContain('color: gold')
    } finally { await metro.stop(); await rm(root, { recursive: true, force: true }) }
  }, 90_000)
})
