import { describe, it, expect } from 'vitest'
import { MAX_INLINE_FILE_SIZE, MAX_FILE_SIZE, MAX_RECORD_SIZE } from './constants'

// Failing spec (TDD): file storage size constants.

describe('file size constants', () => {
  it('MAX_INLINE_FILE_SIZE is exactly 256KB (262_144 bytes)', () => {
    expect(MAX_INLINE_FILE_SIZE).toBe(262_144)
  })

  it('MAX_FILE_SIZE is exactly 4MB (4_194_304 bytes)', () => {
    expect(MAX_FILE_SIZE).toBe(4_194_304)
  })

  it('inline threshold is below the overall file cap and the record cap', () => {
    expect(MAX_INLINE_FILE_SIZE).toBeLessThan(MAX_FILE_SIZE)
    // Inline file content lives inside the record JSON, which is capped at
    // MAX_RECORD_SIZE — the inline tier must fit within it.
    expect(MAX_INLINE_FILE_SIZE).toBeLessThan(MAX_RECORD_SIZE)
  })
})
