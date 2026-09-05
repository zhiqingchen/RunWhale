import ts from 'typescript'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface MobileSourceFile { path: string; content: string; version?: number }

export interface MobileDiagnostic {
  path: string
  start: number
  length: number
  line: number
  column: number
  category: 'error' | 'warning' | 'suggestion' | 'message'
  code: number
  message: string
}

export interface MobileTypeScriptProject {
  root: string
  moduleStore?: string | undefined
}

export class MobileTypeScriptService {
  private readonly files = new Map<string, { content: string; version: number }>()
  private readonly service: ts.LanguageService
  private readonly root: string
  private readonly configurationErrors: readonly ts.Diagnostic[]

  constructor(initialFiles: readonly MobileSourceFile[] = [], project?: MobileTypeScriptProject) {
    this.root = project ? realpathSync(project.root) : '/'
    const store = project?.moduleStore ? resolve(project.moduleStore) : undefined
    const libraryRoot = store ? join(store, 'typescript/lib') : dirname(ts.getDefaultLibFilePath({}))
    const allowed = (path: string): boolean => {
      const absolute = resolve(path)
      if (within(libraryRoot, absolute) || (store && within(store, absolute))) return true
      if (!project) return true
      if (!within(this.root, absolute)) return false
      try { return within(this.root, realpathSync(absolute)) } catch { return false }
    }
    const disk = {
      fileExists: (path) => allowed(path) && ts.sys.fileExists(path),
      readFile: (path) => allowed(path) ? ts.sys.readFile(path) : undefined,
      directoryExists: (path) => allowed(path) && ts.sys.directoryExists(path),
      getDirectories: (path) => allowed(path) ? ts.sys.getDirectories(path) : [],
    } satisfies ts.ModuleResolutionHost
    const defaults: ts.CompilerOptions = {
      allowJs: true, checkJs: true, jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      types: [],
    }
    const configPath = join(this.root, 'tsconfig.json')
    const config = project && disk.fileExists(configPath) ? ts.readConfigFile(configPath, disk.readFile) : undefined
    if (config?.error) {
      throw new Error(`TypeScript configuration: ${ts.flattenDiagnosticMessageText(config.error.messageText, '\n')}`)
    }
    const parsed = config ? ts.parseJsonConfigFileContent(config.config, {
      useCaseSensitiveFileNames: true, fileExists: disk.fileExists, readFile: disk.readFile,
      readDirectory: (path, extensions, exclude, include, depth) => allowed(path)
        ? ts.sys.readDirectory(path, extensions, exclude, include, depth).filter(allowed) : [],
    }, this.root, undefined, configPath) : undefined
    this.configurationErrors = parsed?.errors ?? []
    const options = { ...defaults, ...parsed?.options, noEmit: true }
    if (store) options.typeRoots = [join(this.root, 'node_modules/@types'), join(store, '@types')]
    if (!disk.fileExists(join(libraryRoot, ts.getDefaultLibFileName(options)))) {
      throw new Error('TypeScript environment is unavailable: shared standard library is missing')
    }
    for (const file of initialFiles) this.update(file.path, file.content, file.version ?? 1)
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...new Set([...(parsed?.fileNames ?? []), ...this.files.keys()])],
      getScriptVersion: (path) => String(this.files.get(path)?.version ?? 0),
      getScriptSnapshot: (path) => {
        const content = this.files.get(path)?.content ?? disk.readFile(path)
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
      },
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: (options) => join(libraryRoot, ts.getDefaultLibFileName(options)),
      fileExists: (path) => this.files.has(path) || disk.fileExists(path),
      readFile: (path) => this.files.get(path)?.content ?? disk.readFile(path),
      directoryExists: disk.directoryExists,
      getDirectories: disk.getDirectories,
      resolveModuleNames: (names, containingFile) => names.map((name) => {
        const local = ts.resolveModuleName(name, containingFile, options, host).resolvedModule
        if (local || !store || name.startsWith('.') || isAbsolute(name)) return local
        return ts.resolveModuleName(name, join(store, '__runwhale_types__.tsx'), options, host).resolvedModule
      }),
    }
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry())
  }

  update(path: string, content: string, version?: number): number {
    const normalized = this.sourcePath(path)
    const current = this.files.get(normalized)
    const nextVersion = version ?? (current?.version ?? 0) + 1
    if (current && nextVersion <= current.version) throw new Error(`source version must increase for ${normalized}`)
    this.files.set(normalized, { content, version: nextVersion })
    return nextVersion
  }

  remove(path: string): boolean { return this.files.delete(this.sourcePath(path)) }

  diagnostics(path?: string): MobileDiagnostic[] {
    const targets = path ? [this.sourcePath(path)] : [...this.files.keys()]
    const configuration = [...this.configurationErrors, ...this.service.getCompilerOptionsDiagnostics()]
      .map((diagnostic) => this.toDiagnostic(join(this.root, 'tsconfig.json'), diagnostic))
    return configuration.concat(targets.flatMap((target) => [
      ...this.service.getSyntacticDiagnostics(target),
      ...this.service.getSemanticDiagnostics(target),
      ...this.service.getSuggestionDiagnostics(target),
    ].map((diagnostic) => this.toDiagnostic(target, diagnostic))))
  }

  completions(path: string, position: number): readonly ts.CompletionEntry[] {
    return this.service.getCompletionsAtPosition(this.sourcePath(path), position, {
      includeCompletionsForModuleExports: true,
      includeInsertTextCompletions: true,
    })?.entries ?? []
  }

  definitions(path: string, position: number): readonly ts.DefinitionInfo[] {
    return this.service.getDefinitionAtPosition(this.sourcePath(path), position) ?? []
  }

  references(path: string, position: number): readonly ts.ReferenceEntry[] {
    return this.service.getReferencesAtPosition(this.sourcePath(path), position) ?? []
  }

  dispose(): void { this.service.dispose() }

  private sourcePath(path: string): string {
    if (path.includes('\\') || path.split('/').includes('..')) throw new Error(`invalid source path: ${path}`)
    const absolute = resolve(this.root, path)
    if (!within(this.root, absolute)) throw new Error(`source path is outside the project: ${path}`)
    return absolute
  }

  private toDiagnostic(path: string, diagnostic: ts.Diagnostic): MobileDiagnostic {
    const source = diagnostic.file ?? this.service.getProgram()?.getSourceFile(path)
    const start = diagnostic.start ?? 0
    const point = source?.getLineAndCharacterOfPosition(Math.min(start, source.text.length)) ?? { line: 0, character: 0 }
    return {
      path: relative(this.root, diagnostic.file?.fileName ?? path).split(sep).join('/'),
      start,
      length: diagnostic.length ?? 0,
      line: point.line + 1,
      column: point.character + 1,
      category: categoryName(diagnostic.category),
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }
  }
}

function within(root: string, path: string): boolean {
  const local = relative(root, path)
  return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`))
}

function categoryName(value: ts.DiagnosticCategory): MobileDiagnostic['category'] {
  switch (value) {
    case ts.DiagnosticCategory.Error: return 'error'
    case ts.DiagnosticCategory.Warning: return 'warning'
    case ts.DiagnosticCategory.Suggestion: return 'suggestion'
    default: return 'message'
  }
}
