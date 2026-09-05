import { describe, expect, it } from 'vitest'
import { normalizeProjectName, projectNameValidationIssue, validatedProjectName } from '../src/project-name.js'

describe('project names', () => {
  it('normalizes surrounding and repeated whitespace', () => {
    expect(normalizeProjectName('  Meteor   Dodge  ')).toBe('Meteor Dodge')
    expect(validatedProjectName(' Meteor Dodge ')).toBe('Meteor Dodge')
  })

  it('rejects empty, unsafe, and overlong names', () => {
    expect(projectNameValidationIssue('   ')).toBe('empty')
    expect(projectNameValidationIssue('../secret')).toBe('invalid-character')
    expect(projectNameValidationIssue('x'.repeat(81))).toBe('too-long')
  })
})
