import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHaloClient } from '../src/client.js'
import { loadConfig } from '../src/config.js'
import { CliError, toCliError } from '../src/errors.js'
import { main } from '../src/index.js'

vi.mock('../src/client.js', () => ({ createHaloClient: vi.fn() }))
let directory: string
const get = vi.fn()
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-auth-credentials-'))
  vi.stubEnv('HALO_CLI_CONFIG_DIR', directory)
  vi.stubEnv('HALO_BASE_URL', 'https://env.example')
  vi.stubEnv('HALO_TOKEN', 'pat_env')
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.mocked(createHaloClient).mockResolvedValue({ http: { get } as never, name: 'options', url: 'https://halo.example' })
  get.mockReset().mockResolvedValue({ data: { username: 'alice', keyName: 'key-one', keyDisplayName: 'CLI', scopes: ['read'] } })
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(createHaloClient).mockReset()
  await rm(directory, { recursive: true })
})
const login = (...args: string[]) => main(['node', 'halo-cli', 'auth', 'login', ...args])

describe('login credentials', () => {
  it.each([
    ['hcli_secret', '/apis/console.api.halo-cli.halo.run/v1alpha1/auth/me'],
    ['pat_secret', '/apis/api.console.halo.run/v1alpha1/users/-'],
    ['legacy-token', '/apis/api.console.halo.run/v1alpha1/users/-'],
  ])('verifies %s with the appropriate endpoint and saves a compatible profile', async (token, endpoint) => {
    await login('--profile', 'work', '--url', 'https://halo.example', '--token', token, '--json')
    expect(get).toHaveBeenCalledExactlyOnceWith(endpoint)
    expect((await loadConfig()).profiles.work).toEqual({ url: 'https://halo.example', token })
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).not.toContain(token)
    await main(['node', 'halo-cli', 'auth', 'list', '--json'])
    await main(['node', 'halo-cli', 'auth', 'current', '--json'])
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).not.toContain(token)
  })

  it('accepts a complete environment pair for login', async () => {
    await login('--skip-verify')
    expect((await loadConfig()).profiles.default).toEqual({ url: 'https://env.example', token: 'pat_env' })
  })

  it('does not complete explicit credentials from environment', async () => {
    await expect(login('--url', 'https://other.example', '--skip-verify')).rejects.toThrow('凭据')
    expect((await loadConfig()).profiles).toEqual({})
  })

  it.each([{}, { username: 'alice', keyName: 'one', keyDisplayName: 'CLI', scopes: [1] }])('does not save invalid handshake responses or fall back to PAT', async (data) => {
    get.mockResolvedValue({ data })
    await expect(login('--url', 'https://halo.example', '--token', 'hcli_secret')).rejects.toThrow('响应无效')
    expect(get).toHaveBeenCalledTimes(1)
    expect((await loadConfig()).profiles).toEqual({})
  })

  it('does not save a failed verification or fall back to PAT', async () => {
    get.mockRejectedValue({ isAxiosError: true, response: { status: 401 } })
    await expect(login('--url', 'https://halo.example', '--token', 'hcli_secret')).rejects.toBeDefined()
    expect(get).toHaveBeenCalledTimes(1)
    expect((await loadConfig()).profiles).toEqual({})
  })

  it('rejects token and stdin together before reading stdin', async () => {
    const iterator = vi.spyOn(process.stdin, Symbol.asyncIterator)
    await expect(login('--url', 'https://halo.example', '--token', 'pat_secret', '--token-stdin')).rejects.toThrow('不能与')
    expect(iterator).not.toHaveBeenCalled()
  })

  it('reads a single piped token with a terminal newline', async () => {
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield Buffer.from('hcli_stdin\r\n'); return undefined })
    await login('--profile', 'pipe', '--url', 'https://halo.example', '--token-stdin', '--skip-verify', '--json')
    expect((await loadConfig()).profiles.pipe?.token).toBe('hcli_stdin')
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).not.toContain('hcli_stdin')
  })

  it.each(['', 'pat_one\npat_two\n', 'pat_bad\u0000\n'])('rejects invalid stdin without saving', async (input) => {
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield Buffer.from(input); return undefined })
    await expect(login('--url', 'https://halo.example', '--token-stdin', '--skip-verify')).rejects.toThrow('凭据')
    expect((await loadConfig()).profiles).toEqual({})
  })
})

describe('safe errors', () => {
  it.each([401, 403, 404, 500, undefined])('never echoes untrusted API detail or transport errors (%s)', (status) => {
    const error = Object.assign(new Error('legacy-secret'), {
      isAxiosError: true, response: { status, data: { detail: 'hcli_secret pat_secret legacy-secret' } },
    })
    expect(toCliError(error).message).not.toMatch(/hcli_secret|pat_secret|legacy-secret/)
  })
  it('does not echo arbitrary exception messages', () => {
    expect(toCliError(new Error('legacy-secret')).message).not.toContain('legacy-secret')
    expect(new CliError('invalid hcli_secret or pat_secret').message).not.toMatch(/hcli_secret|pat_secret/)
  })
})
