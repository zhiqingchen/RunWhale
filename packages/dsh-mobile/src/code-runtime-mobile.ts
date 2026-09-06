import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import ts from 'typescript'

export class MobileCodeRuntime extends WorkerThreadCodeRuntime {
  // iOS runs without WebAssembly, which Node's built-in type stripper requires.
  protected override compile(program: string): string {
    const result = ts.transpileModule(`export async function __runwhale_program__() {\n${program}\n}`, {
      fileName: 'program.ts',
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    })
    const failures = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
    if (failures.length) throw new SyntaxError(failures.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'))

    // Extract the emitted body by syntax boundaries: transpilation changes offsets.
    const source = ts.createSourceFile('program.js', result.outputText, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS)
    const wrapper = source.statements[0]
    if (source.statements.length !== 1 || !wrapper || !ts.isFunctionDeclaration(wrapper) || wrapper.name?.text !== '__runwhale_program__' || !wrapper.body) {
      throw new SyntaxError('program must be an async function body')
    }
    return result.outputText.slice(wrapper.body.getStart(source) + 1, wrapper.body.end - 1)
  }
}
