import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { normalizeUrl, resolveProfile, validateToken } from '../src/config.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('credential source isolation', () => {
  it.each([
    [{ url: 'https://other.example' }, { HALO_TOKEN: 'pat_env' }],
    [{ token: 'pat_option' }, { HALO_BASE_URL: 'https://env.example' }],
    [{ url: 'https://other.example' }, { HALO_BASE_URL: 'https://env.example', HALO_TOKEN: 'pat_env' }],
    [{ token: 'pat_option' }, { HALO_BASE_URL: 'https://env.example', HALO_TOKEN: 'pat_env' }],
  ])('rejects incomplete explicit credentials without borrowing from environment', async (options, environment) => {
    await expect(resolveProfile(options, environment)).rejects.toThrow('同时提供')
  })

  it('allows a complete explicit pair to override a profile and environment', async () => {
    await expect(resolveProfile({ profile: 'saved', url: 'https://once.example', token: 'hcli_once' }, {
      HALO_BASE_URL: 'https://env.example', HALO_TOKEN: 'pat_env',
    })).resolves.toEqual({ name: 'options', profile: { url: 'https://once.example', token: 'hcli_once' } })
  })

  it('uses an explicit legacy profile even with incomplete or complete environment credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-credential-sources-'))
    directories.push(directory)
    await writeFile(join(directory, 'config.json'), JSON.stringify({
      currentProfile: 'old', profiles: { old: { url: 'https://old.example/', token: 'legacy-token' } },
    }))
    for (const credentials of [{ HALO_TOKEN: 'pat_env' }, { HALO_BASE_URL: 'https://env.example', HALO_TOKEN: 'pat_env' }]) {
      await expect(resolveProfile({ profile: 'old' }, { HALO_CLI_CONFIG_DIR: directory, ...credentials }))
        .resolves.toEqual({ name: 'old', profile: { url: 'https://old.example', token: 'legacy-token' } })
    }
    await expect(resolveProfile({}, { HALO_CLI_CONFIG_DIR: directory })).resolves.toMatchObject({ name: 'old' })
    await expect(resolveProfile({ profile: 'missing' }, { HALO_CLI_CONFIG_DIR: directory, HALO_TOKEN: 'pat_env' }))
      .rejects.toThrow('不存在')
    await expect(resolveProfile({}, { HALO_CLI_CONFIG_DIR: directory, HALO_TOKEN: 'pat_env' }))
      .rejects.toThrow('同时提供')
  })

  it.each(['https://user:secret@example.com', 'https://example.com?token=secret', 'https://example.com#secret', 'bad-secret-url'])('rejects unsafe URLs without echoing input', (url) => {
    expect(() => normalizeUrl(url)).toThrow()
    expect(() => normalizeUrl(url)).not.toThrow('secret')
  })

  it.each(['', 'pat_bad token', 'hcli_bad\r\nHeader:value', 'pat_bad\u0000', ' token'])('rejects unsafe tokens without echoing input', (token) => {
    expect(() => validateToken(token)).toThrow('凭据')
  })

  it('enforces the token limit on every credential source', async () => {
    const token = 'x'.repeat(4097)
    expect(validateToken('x'.repeat(4096))).toHaveLength(4096)
    await expect(resolveProfile({ url: 'https://halo.example', token }, {})).rejects.toThrow('4096')
    await expect(resolveProfile({}, { HALO_BASE_URL: 'https://halo.example', HALO_TOKEN: token })).rejects.toThrow('4096')
    const directory = await mkdtemp(join(tmpdir(), 'halo-token-limit-'))
    directories.push(directory)
    await writeFile(join(directory, 'config.json'), JSON.stringify({
      currentProfile: 'saved', profiles: { saved: { url: 'https://halo.example', token } },
    }))
    await expect(resolveProfile({}, { HALO_CLI_CONFIG_DIR: directory })).rejects.toThrow('4096')
  })
})
