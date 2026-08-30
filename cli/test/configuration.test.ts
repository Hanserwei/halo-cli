import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { redactSecrets, isSensitiveKey, writeJsonExport } from '../src/secrets.js'
import { printOrExportJson } from '../src/structured-output.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'halo-cli-config-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('configuration secrets and exports', () => {
  it('recognizes common snake, kebab, and camel case secret keys', () => {
    expect(isSensitiveKey('password')).toBe(true)
    expect(isSensitiveKey('clientSecret')).toBe(true)
    expect(isSensitiveKey('api-key')).toBe(true)
    expect(isSensitiveKey('private_key')).toBe(true)
    expect(isSensitiveKey('monkey')).toBe(false)
    expect(isSensitiveKey('endpoint')).toBe(false)
  })

  it('redacts nested configuration secrets without changing safe values', () => {
    expect(
      redactSecrets({
        apiKey: 'api-secret',
        nested: { accessToken: 'token-secret', endpoint: 'https://example.test' },
        profiles: [{ clientSecret: 'client-secret', name: 'default' }],
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', endpoint: 'https://example.test' },
      profiles: [{ clientSecret: '[REDACTED]', name: 'default' }],
    })
  })

  it('writes private JSON exports atomically and refuses accidental replacement', async () => {
    const directory = await temporaryDirectory()
    const output = join(directory, 'plugin.json')
    await writeJsonExport(output, { endpoint: 'https://example.test' })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ endpoint: 'https://example.test' })
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    await expect(writeJsonExport(output, { changed: true })).rejects.toThrow('--force')
    await writeJsonExport(output, { changed: true }, true)
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ changed: true })
    expect((await readdir(directory)).sort()).toEqual(['plugin.json'])
  })

  it('does not allow secrets to be printed to the terminal', async () => {
    await expect(
      printOrExportJson({ clientSecret: 'secret' }, { includeSecrets: true }, '插件配置'),
    ).rejects.toThrow('--output')
  })

  it('exports a redacted JSON document with a 0600 file mode', async () => {
    const directory = await temporaryDirectory()
    const output = join(directory, 'theme.json')
    await printOrExportJson(
      { apiKey: 'secret', endpoint: 'https://example.test' },
      { output },
      '主题配置',
    )
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({
      apiKey: '[REDACTED]',
      endpoint: 'https://example.test',
    })
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    await writeFile(join(directory, 'unused.tmp'), 'temporary')
  })
})
