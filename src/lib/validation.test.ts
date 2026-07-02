import { describe, it, expect } from 'vitest'
import { validateTrimmedLength } from './validation'

describe('validateTrimmedLength', () => {
  it('returns the trimmed value when within bounds', () => {
    expect(validateTrimmedLength('  hello  ', 100, 'Name')).toEqual({ value: 'hello' })
  })

  it('returns 400 when value is empty after trim', () => {
    expect(validateTrimmedLength('   ', 100, 'Name')).toEqual({
      error: 'Name cannot be empty',
      status: 400,
    })
  })

  it('returns 400 when trimmed value exceeds max length', () => {
    const result = validateTrimmedLength('x'.repeat(101), 100, 'Name')
    expect(result).toEqual({ error: 'Name must be 100 characters or fewer', status: 400 })
  })

  it('counts the trimmed length, not the raw input length', () => {
    const value = '   ' + 'x'.repeat(100) + '   '
    expect(validateTrimmedLength(value, 100, 'Name')).toEqual({ value: 'x'.repeat(100) })
  })

  it('uses the supplied label in error messages', () => {
    expect(validateTrimmedLength('', 50, 'Option value')).toEqual({
      error: 'Option value cannot be empty',
      status: 400,
    })
  })
})
