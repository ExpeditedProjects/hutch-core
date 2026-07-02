import { describe, it, expect } from 'vitest'
import { slugify } from './slugify'

describe('slugify', () => {
  it('converts text to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugify('my collection name')).toBe('my-collection-name')
  })

  it('removes special characters', () => {
    expect(slugify('hello@world!')).toBe('helloworld')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('hello---world')).toBe('hello-world')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('-hello-world-')).toBe('hello-world')
  })

  it('handles underscores', () => {
    expect(slugify('hello_world')).toBe('hello-world')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles whitespace-only string', () => {
    expect(slugify('   ')).toBe('')
  })
})
