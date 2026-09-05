import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { inspect } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import ts from 'typescript'

interface WorkerData {
  entry: string
  args: string[]
}

const port = parentPort
if (!port) throw new Error('task worker requires a parent message port')
const data = workerData as WorkerData

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !['.ts', '.tsx', '.mts'].includes(extname(new URL(url).pathname))) return nextLoad(url, context)
    const fileName = fileURLToPath(url)
    const result = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
      },
    })
    const failures = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
    if (failures.length > 0) throw new SyntaxError(failures.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'))
    return { format: 'module', shortCircuit: true, source: result.outputText }
  },
})

const write = (...values: unknown[]): void => {
  port.postMessage({ type: 'output', chunk: `${values.map(value => typeof value === 'string' ? value : inspect(value)).join(' ')}\n` })
}
console.log = write
console.info = write
console.warn = write
console.error = write
process.argv = ['node', data.entry, ...data.args]

try {
  await import(`${pathToFileURL(data.entry).href}?task=${Date.now().toString(36)}`)
  port.postMessage({ type: 'done' })
} catch (error) {
  port.postMessage({ type: 'done', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
}
