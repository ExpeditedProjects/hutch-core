import { describe, it, expect } from 'vitest'
import type { FieldType } from './field-types'
import { isSelectableField } from './field-types'

// Failing spec (TDD): the FieldType union gains "file".
//
// NOTE: FieldType is a pure type with no runtime artifact, so the union
// membership is a compile-time contract — the assignment below fails `tsc`
// (and `next build`) until "file" joins the union, even though vitest's
// runtime pass is green.

describe('FieldType union', () => {
  it('includes "file" (compile-time contract — enforced by tsc, not runtime)', () => {
    const fileType: FieldType = 'file'
    expect(fileType).toBe('file')
  })

  it('"file" is not a selectable field type', () => {
    expect(isSelectableField({ type: 'file' })).toBe(false)
  })
})
