export interface TextProjectFile {
  path: string
  content: string
}

export async function readTextProjectFiles(
  paths: readonly string[],
  read: (path: string) => Promise<{ content: string }>,
): Promise<TextProjectFile[]> {
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return { path, content: (await read(path)).content }
    } catch (cause) {
      if (!isUnsupportedTextFileError(cause)) throw cause
      return undefined
    }
  }))
  return files.filter((file): file is TextProjectFile => file !== undefined)
}

function isUnsupportedTextFileError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes('binary files cannot be read as text')
    || /file exceeds \d+ byte read limit/i.test(message)
    || /(?:invalid|not valid).{0,40}(?:utf-?8|encoding)|(?:utf-?8|encoding).{0,40}(?:invalid|not valid)/i.test(message)
}
