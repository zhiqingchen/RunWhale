import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The browser already implements ordinary CSS. Avoid Lightning CSS's desktop
// native addon in Node Mobile, while letting Metro track CSS imports and HMR.
export async function webTransformerPath(store: string, upstream: string): Promise<string> {
  const source = String.raw`
const upstream = require(${JSON.stringify(upstream)});
const worker = require(${JSON.stringify(join(dirname(upstream), 'metro-transform-worker.js'))});
const { createHash } = require('node:crypto');
exports.transform = function(config, projectRoot, filename, data, options) {
  if (options.platform !== 'web' || !(/\.(css|scss|sass)$/.test(filename))) {
    return upstream.transform(config, projectRoot, filename, data, options);
  }
  if (!filename.endsWith('.css') || filename.endsWith('.module.css')) {
    throw new Error('Embedded Web Preview supports ordinary CSS imports; CSS Modules and Sass are not supported. Use a .css stylesheet with className.');
  }
  const asset = '/__runwhale_assets__/' + filename.split('/').map(encodeURIComponent).join('/');
  const key = 'runwhale-css-' + createHash('sha256').update(filename).digest('hex');
  const revision = createHash('sha256').update(data).digest('hex');
  const code = 'var previous = document.getElementById(' + JSON.stringify(key) + ');' +
    'var link = previous || document.createElement("link"); link.id = ' + JSON.stringify(key) + '; link.rel = "stylesheet";' +
    'var url = new URL(' + JSON.stringify(asset) + ', location.origin);' +
    'url.searchParams.set("token", new URLSearchParams(location.search).get("token") || "");' +
    'url.searchParams.set("revision", ' + JSON.stringify(revision) + '); link.href = url.href;' +
    'if (!previous) document.head.appendChild(link);' +
    'if (module.hot) module.hot.accept();';
  return worker.transform(config, projectRoot, filename + '.js', Buffer.from(code), options);
};
`
  const directory = join(store, '.cache', 'runwhale')
  const path = join(directory, `web-transformer-${createHash('sha256').update(source).digest('hex').slice(0, 16)}.cjs`)
  await mkdir(directory, { recursive: true })
  await writeFile(path, source)
  return path
}
