export type ProjectSourceMetadata =
  | { kind: 'local' }
  | { kind: 'github'; url: string; commit?: string }
  | { kind: 'git'; url: string; commit?: string }

export function emptyProjectManifest(id: string, name: string, source: ProjectSourceMetadata = { kind: 'local' }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    name,
    runtimeAbi: {},
    entry: {},
    capabilities: [],
    tasks: {},
    source,
  }
}

export function emptyProjectFiles(id: string, name: string): Readonly<Record<string, string>> {
  return Object.freeze({
    '.gitignore': '.runwhale/sessions/\n.runwhale/cache/\n.runwhale/package-staging/\n.runwhale/git-audit.jsonl\nnode_modules/\n',
    'runwhale.json': `${JSON.stringify(emptyProjectManifest(id, name), null, 2)}\n`,
  })
}
