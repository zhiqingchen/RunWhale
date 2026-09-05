import { describe, expect, it } from 'vitest'
import type { StudioProject } from '../src/state/projects'
import { projectPreviewConfiguration } from '../src/utils/project-preview'

function project(manifest: Record<string, unknown>): StudioProject {
  return {
    id: 'project-preview',
    name: 'Project Preview',
    description: '',
    updatedAt: 1,
    files: [{ path: 'runwhale.json', content: JSON.stringify(manifest) }],
  }
}

describe('project Preview configuration', () => {
  it('automatically selects a project with one compatible Preview target', () => {
    expect(projectPreviewConfiguration(project({ entry: { web: 'src/main.tsx' } }), 'android')).toEqual({ target: 'web', platform: 'web' })
    expect(projectPreviewConfiguration(project({ entry: { ios: 'index.ts' } }), 'ios')).toEqual({ target: 'native', platform: 'ios' })
  })

  it('uses the project selection when both Web and Native entries exist', () => {
    const manifest = { entry: { web: 'src/main.tsx', android: 'index.ts' }, preview: { target: 'native' } }
    expect(projectPreviewConfiguration(project(manifest), 'android')).toEqual({ target: 'native', platform: 'android' })
    expect(projectPreviewConfiguration(project({ ...manifest, preview: { target: 'web' } }), 'android')).toEqual({ target: 'web', platform: 'web' })
  })

  it('does not invent a Studio default for an ambiguous project', () => {
    const manifest = { entry: { web: 'src/main.tsx', android: 'index.ts' } }
    expect(projectPreviewConfiguration(project(manifest), 'android')).toEqual({
      error: 'Project declares both Web and Native Preview entries; set preview.target in runwhale.json',
    })
  })

  it('reports a selected target that is unavailable on the current platform', () => {
    const manifest = { entry: { ios: 'index.ts' }, preview: { target: 'native' } }
    expect(projectPreviewConfiguration(project(manifest), 'android')).toEqual({
      error: 'Project selects Native Preview but does not declare entry.android',
    })
  })
})
