import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadConfig } from '../src/config.js'
import { main } from '../src/index.js'

const originalConfigDirectory = process.env.HALO_CLI_CONFIG_DIR
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalConfigDirectory === undefined) {
    delete process.env.HALO_CLI_CONFIG_DIR
  } else {
    process.env.HALO_CLI_CONFIG_DIR = originalConfigDirectory
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('two-level command routing', () => {
  it('runs a nested auth action instead of silently returning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-routing-'))
    temporaryDirectories.push(directory)
    process.env.HALO_CLI_CONFIG_DIR = directory
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'auth',
      'login',
      '--url',
      'http://127.0.0.1:8090',
      '--token',
      'pat_test',
      '--skip-verify',
      '--json',
    ])

    expect(await loadConfig()).toEqual({
      currentProfile: 'default',
      profiles: {
        default: { token: 'pat_test', url: 'http://127.0.0.1:8090' },
      },
    })
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"verified": false'))
  })
})
