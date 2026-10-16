import { describe, expect, it } from 'vitest'

import { assertConfiguration, configurationChanges, configurationFields, configurationReset, redactConfiguration, redactConfigurationSchema } from '../src/configuration.js'
import type { Setting } from '../src/types.js'

const schema: Setting = {
  apiVersion: 'v1alpha1', kind: 'Setting', metadata: { name: 'example' },
  spec: { forms: [{ group: 'base', formSchema: [
    { $formkit: 'text', name: 'title', validation: 'required' },
    { $formkit: 'switch', name: 'enabled', value: true },
    { $formkit: 'password', name: 'credential', value: 'example-default' },
    { $formkit: 'group', name: 'panel', children: [
      { $formkit: 'number', name: 'limit', min: 0, max: 100, value: 5 },
      { $formkit: 'repeater', name: 'entries', value: [], children: [
        { $formkit: 'text', name: 'label' },
        { $formkit: 'password', name: 'value' },
      ] },
    ] },
    { $formkit: 'text', name: 'conditional', validation: 'required', if: '$get(enabled).value' },
  ] }] },
}

describe('schema-driven configuration', () => {
  it('discovers nested and repeated pointers without flattening ordered values', () => {
    expect(configurationFields(schema).map((field) => field.pointer)).toContain('/base/panel/entries/*/value')
    expect(configurationFields(schema).find((field) => field.pointer === '/base/conditional')?.conditional).toBe(true)
  })

  it('preserves required fields with no default while resetting declared defaults', () => {
    const result = configurationReset(schema, { base: { title: 'My site', enabled: false, panel: { limit: 90, entries: [{ label: 'x', value: 'private' }] } } })
    expect(result).toMatchObject({ base: { title: 'My site', enabled: true, panel: { limit: 5, entries: [] } } })
    expect(() => assertConfiguration(result, schema)).not.toThrow()
    expect(() => assertConfiguration(configurationReset(schema, {}), schema)).toThrow('/base/title')
  })

  it('accepts false and empty arrays while rejecting wrong field types or redacted imports', () => {
    expect(() => assertConfiguration({ base: { title: 'Site', enabled: false, panel: { entries: [] } } }, schema)).not.toThrow()
    expect(() => assertConfiguration({ base: { title: 'Site', enabled: 'false' } }, schema)).toThrow('类型')
    expect(() => assertConfiguration({ base: { title: 'Site', credential: '[REDACTED]' } }, schema)).toThrow('REDACTED')
  })

  it('redacts password inputs including repeated values even when field names are generic', () => {
    const input = { base: { title: 'Site', credential: 'private-value', panel: { entries: [{ label: 'first', value: 'one' }, { label: 'first', value: 'two' }] } } }
    const result = redactConfiguration(input, schema)
    expect(JSON.stringify(result)).not.toMatch(/private-value|"one"|"two"/u)
    expect(result).toMatchObject({ base: { panel: { entries: [{ label: 'first', value: '[REDACTED]' }, { label: 'first', value: '[REDACTED]' }] } } })
    expect(input.base.credential).toBe('private-value')
    expect(JSON.stringify(redactConfigurationSchema(schema))).not.toContain('example-default')
  })

  it('reports secret changes without including their values', () => {
    const before = { base: { title: 'Site', credential: 'old-value' } }
    const after = { base: { title: 'Updated', credential: 'new-value' } }
    const changes = configurationChanges(before, after, schema)
    expect(changes).toContainEqual({ pointer: '/base/credential', before: '[REDACTED]', after: '[REDACTED]' })
    expect(JSON.stringify(changes)).not.toMatch(/old-value|new-value/u)
  })
})

it('supports Halo FormKit array fields without inventing required fields outside their rows', () => {
  const arraySchema: Setting = { apiVersion: 'v1alpha1', kind: 'Setting', metadata: { name: 'array-setting' }, spec: { forms: [
    { group: 'footer', formSchema: [{ $formkit: 'array', name: 'social', value: [], children: [
      { $formkit: 'text', name: 'name', validation: 'required' },
      { $formkit: 'text', name: 'url', validation: 'required' },
    ] }] },
  ] } }
  expect(configurationFields(arraySchema).map((field) => field.pointer)).toContain('/footer/social/*/name')
  expect(() => assertConfiguration({ footer: { social: [] } }, arraySchema)).not.toThrow()
  expect(() => assertConfiguration({ footer: { social: [{ name: 'GitHub' }] } }, arraySchema)).toThrow('/footer/social/*/url')
})
