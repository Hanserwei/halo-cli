import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { configPath, loadConfig, normalizeUrl, resolveProfile, saveConfig } from '../src/config.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'halo-cli-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('CLI configuration', () => {
  it('uses the explicit configuration directory', () => {
    expect(configPath({ HALO_CLI_CONFIG_DIR: '/tmp/custom-halo-cli' })).toBe(
      '/tmp/custom-halo-cli/config.json',
    )
  })

  it('writes and reads a private configuration file', async () => {
    const path = join(await temporaryDirectory(), 'nested', 'config.json')
    await saveConfig(
      {
        currentProfile: 'local',
        profiles: { local: { token: 'pat_secret', url: 'http://127.0.0.1:8090' } },
      },
      path,
    )

    expect(await loadConfig(path)).toEqual({
      currentProfile: 'local',
      profiles: { local: { token: 'pat_secret', url: 'http://127.0.0.1:8090' } },
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).toContain('pat_secret')
  })

  it('prefers environment credentials without requiring a saved profile', async () => {
    const resolved = await resolveProfile({}, {
      HALO_BASE_URL: 'https://example.com/',
      HALO_TOKEN: 'pat_ci',
    })
    expect(resolved).toEqual({
      name: 'environment',
      profile: { token: 'pat_ci', url: 'https://example.com' },
    })
  })

  it('normalizes valid URLs and rejects unsupported protocols', () => {
    expect(normalizeUrl('http://localhost:8090/')).toBe('http://localhost:8090')
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow('http 或 https')
  })
})
