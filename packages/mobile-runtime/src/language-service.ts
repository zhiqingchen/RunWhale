import ts from 'typescript'

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

export class MobileTypeScriptService {
  private readonly files = new Map<string, { content: string; version: number }>()
  private readonly service: ts.LanguageService

  constructor(initialFiles: readonly MobileSourceFile[] = []) {
    for (const file of initialFiles) this.update(file.path, file.content, file.version ?? 1)
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({
        allowJs: true,
        checkJs: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      }),
      getScriptFileNames: () => [...this.files.keys()],
      getScriptVersion: (path) => String(this.files.get(path)?.version ?? 0),
      getScriptSnapshot: (path) => {
        const content = this.files.get(path)?.content ?? ts.sys.readFile(path)
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
      },
      getCurrentDirectory: () => '/',
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (path) => this.files.has(path) || ts.sys.fileExists(path),
      readFile: (path) => this.files.get(path)?.content ?? ts.sys.readFile(path),
      readDirectory: ts.sys.readDirectory,
    }
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry())
  }

  update(path: string, content: string, version?: number): number {
    const normalized = normalizeVirtualPath(path)
    const current = this.files.get(normalized)
    const nextVersion = version ?? (current?.version ?? 0) + 1
    if (current && nextVersion <= current.version) throw new Error(`source version must increase for ${normalized}`)
    this.files.set(normalized, { content, version: nextVersion })
    return nextVersion
  }

  remove(path: string): boolean { return this.files.delete(normalizeVirtualPath(path)) }

  diagnostics(path?: string): MobileDiagnostic[] {
    const targets = path ? [normalizeVirtualPath(path)] : [...this.files.keys()]
    return targets.flatMap((target) => [
      ...this.service.getSyntacticDiagnostics(target),
      ...this.service.getSemanticDiagnostics(target),
      ...this.service.getSuggestionDiagnostics(target),
    ].map((diagnostic) => this.toDiagnostic(target, diagnostic)))
  }

  completions(path: string, position: number): readonly ts.CompletionEntry[] {
    return this.service.getCompletionsAtPosition(normalizeVirtualPath(path), position, {
      includeCompletionsForModuleExports: true,
      includeInsertTextCompletions: true,
    })?.entries ?? []
  }

  definitions(path: string, position: number): readonly ts.DefinitionInfo[] {
    return this.service.getDefinitionAtPosition(normalizeVirtualPath(path), position) ?? []
  }

  references(path: string, position: number): readonly ts.ReferenceEntry[] {
    return this.service.getReferencesAtPosition(normalizeVirtualPath(path), position) ?? []
  }

  dispose(): void { this.service.dispose() }

  private toDiagnostic(path: string, diagnostic: ts.Diagnostic): MobileDiagnostic {
    const source = diagnostic.file ?? this.service.getProgram()?.getSourceFile(path)
    const start = diagnostic.start ?? 0
    const point = source?.getLineAndCharacterOfPosition(Math.min(start, source.text.length)) ?? { line: 0, character: 0 }
    return {
      path: diagnostic.file?.fileName ?? path,
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

function normalizeVirtualPath(path: string): string {
  if (path.includes('\\') || path.split('/').includes('..')) throw new Error(`invalid source path: ${path}`)
  return path.startsWith('/') ? path : `/${path}`
}

function categoryName(value: ts.DiagnosticCategory): MobileDiagnostic['category'] {
  switch (value) {
    case ts.DiagnosticCategory.Error: return 'error'
    case ts.DiagnosticCategory.Warning: return 'warning'
    case ts.DiagnosticCategory.Suggestion: return 'suggestion'
    default: return 'message'
  }
}
