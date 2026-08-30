import { describe, expect, it } from 'vitest'

import {
  containsRedactedValue,
  mergeJsonObjects,
  parseJsonValue,
  parseStringRecord,
  setJsonPointer,
} from '../src/json-input.js'

describe('JSON input helpers', () => {
  it('parses JSON scalars and preserves plain strings', () => {
    expect(parseJsonValue('true')).toBe(true)
    expect(parseJsonValue('42')).toBe(42)
    expect(parseJsonValue('plain text')).toBe('plain text')
  })

  it('merges nested objects while replacing arrays', () => {
    expect(
      mergeJsonObjects(
        { top: { enabled: false, items: [1] }, untouched: true },
        { top: { enabled: true, items: [2, 3] } },
      ),
    ).toEqual({ top: { enabled: true, items: [2, 3] }, untouched: true })
  })

  it('sets nested object and array values with JSON Pointer', () => {
    const source = { top: { cards: [{ title: 'Old' }] } }
    expect(setJsonPointer(source, '/top/cards/0/title', 'New')).toEqual({
      top: { cards: [{ title: 'New' }] },
    })
    expect(setJsonPointer({}, '/top/cards/0/title', 'Created')).toEqual({
      top: { cards: [{ title: 'Created' }] },
    })
    expect(source.top.cards[0]?.title).toBe('Old')
  })

  it('rejects unsafe or non-string metadata records', () => {
    expect(() => parseStringRecord('{"enabled":true}', '--annotations')).toThrow(
      '必须是字符串',
    )
    expect(() => setJsonPointer({}, '/__proto__/polluted', true)).toThrow('不安全字段')
  })

  it('finds redaction markers recursively', () => {
    expect(containsRedactedValue({ nested: [{ token: '[REDACTED]' }] })).toBe(true)
    expect(containsRedactedValue({ token: 'real-value' })).toBe(false)
  })
})
