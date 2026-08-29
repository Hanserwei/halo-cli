import { describe, expect, it } from 'vitest'

import {
  booleanValue,
  csv,
  integer,
  positiveInteger,
  requireConfirmation,
  slugify,
} from '../src/options.js'

describe('command option parsing', () => {
  it('parses CSV values and supports explicitly clearing a list', () => {
    expect(csv('news, Halo ,cli')).toEqual(['news', 'Halo', 'cli'])
    expect(csv('')).toEqual([])
    expect(csv(undefined)).toBeUndefined()
  })

  it('validates numeric options', () => {
    expect(positiveInteger('2', 1)).toBe(2)
    expect(integer('-3')).toBe(-3)
    expect(() => positiveInteger('0', 1)).toThrow('大于 0')
    expect(() => integer('1.5')).toThrow('整数')
  })

  it('parses explicit boolean values', () => {
    expect(booleanValue('true', '--enabled')).toBe(true)
    expect(booleanValue('false', '--enabled')).toBe(false)
    expect(() => booleanValue('yes', '--enabled')).toThrow('true 或 false')
  })

  it('creates Unicode-safe slugs', () => {
    expect(slugify('Halo CLI 入门！', 'post')).toBe('halo-cli-入门')
    expect(slugify('!!!', 'post')).toBe('post')
  })

  it('requires an explicit confirmation for destructive commands', () => {
    expect(() => requireConfirmation(false, 'halo-cli post delete test')).toThrow('--yes')
    expect(() => requireConfirmation(true, 'ignored')).not.toThrow()
  })
})
