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

  it('supports JSON output when switching and deleting profiles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-routing-'))
    temporaryDirectories.push(directory)
    process.env.HALO_CLI_CONFIG_DIR = directory
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    for (const profile of ['one', 'two']) {
      await main([
        'node',
        'halo-cli',
        'auth',
        'login',
        '--profile',
        profile,
        '--url',
        `https://${profile}.example`,
        '--token',
        'pat_test',
        '--skip-verify',
      ])
    }

    await main(['node', 'halo-cli', 'auth', 'use', 'one', '--json'])
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"current": true'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"name": "one"'))

    await main(['node', 'halo-cli', 'auth', 'logout', 'one', '--json'])
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"deleted": true'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"currentProfile": "two"'))
  })

  it.each(['page', 'comment', 'attachment', 'menu', 'plugin', 'theme'])('routes the %s command group help', async (group) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await main(['node', 'halo-cli', group])

    expect(output).toHaveBeenCalledWith(expect.stringContaining(`halo-cli ${group}`))
    if (group === 'page') {
      expect(output).toHaveBeenCalledWith(expect.stringContaining('恢复页面内容快照并发布'))
    }
  })

  it.each([
    ['page', 'delete', 'page-one'],
    ['page', 'snapshot-revert', 'page-one', 'snapshot-one'],
    ['comment', 'delete', 'comment-one'],
    ['comment', 'reply-delete', 'reply-one'],
    ['attachment', 'delete', 'attachment-one'],
    ['menu', 'delete', 'menu-one'],
    ['menu', 'item-delete', 'menu-item-one'],
  ])('requires --yes for dangerous %s %s operations', async (...args) => {
    await expect(main(['node', 'halo-cli', ...args])).rejects.toThrow('--yes')
  })

  it('rejects repeated false confirmation flags', async () => {
    await expect(
      main([
        'node',
        'halo-cli',
        'attachment',
        'delete',
        'attachment-one',
        '--yes=false',
        '--yes=false',
      ]),
    ).rejects.toThrow('--yes')
  })
})
