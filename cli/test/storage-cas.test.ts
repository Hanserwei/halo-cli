import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AxiosInstance } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '../src/client.js'
import type { Setting, StoragePolicy } from '../src/types.js'

const mocks = vi.hoisted(() => ({ createHaloClient: vi.fn(), get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('../src/client.js', async (original) => ({ ...(await original<typeof ClientModule>()), createHaloClient: mocks.createHaloClient }))
import { loadStorageConfiguration } from '../src/commands/storage.js'
import { main } from '../src/index.js'

interface Snapshot {
  policyVersion: number
  configMapName: string | null
  configMapVersion: number | null
  config: Record<string, unknown>
}

const configurationPath = '/apis/console.api.halo-cli.halo.run/v1alpha1/policies/s3-personal/configs/default'
const policyPath = '/apis/storage.halo.run/v1alpha1/policies/s3-personal'
const templatePath = '/apis/storage.halo.run/v1alpha1/policytemplates/s3os'
const settingPath = '/api/v1alpha1/settings/s3os-setting'
const readPaths = [policyPath, templatePath, settingPath, configurationPath]
const oldSecret = 's3-secret-before-rotation'
const rotatedSecret = 's3-secret-after-rotation'
const importedSecret = 's3-secret-from-import'
const schema: Setting = {
  apiVersion: 'v1alpha1',
  kind: 'Setting',
  metadata: { name: 's3os-setting' },
  spec: { forms: [{ group: 'default', formSchema: [
    { $formkit: 'text', name: 'bucket', validation: 'required' },
    { $formkit: 'text', name: 'region' },
    { $formkit: 'password', name: 'accessSecret' },
  ] }] },
}
let directory: string

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    policyVersion: 7,
    configMapName: 's3-config',
    configMapVersion: 23,
    config: { bucket: 'old-bucket', region: 'old-region', accessSecret: oldSecret, providerOptions: { keep: true } },
    ...overrides,
  }
}

function apiError(status?: number): Error {
  return Object.assign(new Error(`transport echoed ${oldSecret} ${rotatedSecret} ${importedSecret}`), {
    isAxiosError: true,
    response: status === undefined ? undefined : {
      status,
      data: { detail: `server echoed ${oldSecret} ${rotatedSecret} ${importedSecret}` },
    },
  })
}

// A read returns an isolated snapshot. Each PUT compares all three expectations
// against current backend state before it can modify configuration or association.
function installBackend(initial: Snapshot = snapshot()) {
  const policy: StoragePolicy = {
    apiVersion: 'storage.halo.run/v1alpha1',
    kind: 'Policy',
    metadata: { name: 's3-personal', version: initial.policyVersion },
    spec: { templateName: 's3os', displayName: 'S3', ...(initial.configMapName === null ? {} : { configMapName: initial.configMapName }) },
  }
  const backend = {
    state: structuredClone(initial),
    policy,
    beforeWrite: undefined as (() => void) | undefined,
  }
  mocks.get.mockImplementation(async (path: string) => {
    switch (path) {
      case policyPath: return { data: structuredClone(backend.policy) }
      case templatePath: return { data: { spec: { settingName: 's3os-setting' } } }
      case settingPath: return { data: structuredClone(schema) }
      case configurationPath: return { data: structuredClone(backend.state) }
      default: throw new Error(`Unexpected GET: ${path}`)
    }
  })
  mocks.put.mockImplementation(async (path: string, body: Snapshot) => {
    if (path !== configurationPath) throw new Error(`Unexpected PUT: ${path}`)
    backend.beforeWrite?.()
    const current = backend.state
    if (body.policyVersion !== current.policyVersion || body.configMapName !== current.configMapName || body.configMapVersion !== current.configMapVersion) {
      throw apiError(409)
    }
    backend.state = {
      policyVersion: current.policyVersion + 1,
      configMapName: current.configMapName ?? 'new-s3-config',
      configMapVersion: (current.configMapVersion ?? 0) + 1,
      config: structuredClone(body.config),
    }
    backend.policy.metadata.version = backend.state.policyVersion
    backend.policy.spec.configMapName = backend.state.configMapName ?? undefined
    return { status: 204 }
  })
  return backend
}

function expectSafeRequests(expectedReads: string[] = readPaths): void {
  expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(expectedReads)
  expect(mocks.put.mock.calls.every(([path]) => path === configurationPath)).toBe(true)
  expect(mocks.post).not.toHaveBeenCalled()
  expect(mocks.delete).not.toHaveBeenCalled()
}

function expectNoSecrets(error?: Error): void {
  const displayed = [error?.message, ...vi.mocked(process.stdout.write).mock.calls, ...vi.mocked(process.stderr.write).mock.calls]
  for (const secret of [oldSecret, rotatedSecret, importedSecret]) {
    expect(JSON.stringify(displayed)).not.toContain(secret)
  }
}

async function failure(operation: Promise<unknown>): Promise<Error> {
  const error: unknown = await operation.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(Error)
  return error as Error
}

function setBucket(...options: string[]): Promise<void> {
  return main(['node', 'halo-cli', 'storage', 'config-set', 's3-personal', '/default/bucket', 'new-bucket', '--json', ...options])
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-storage-cas-'))
  mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get, put: mocks.put, post: mocks.post, delete: mocks.delete }, name: 'test', url: 'https://halo.example' })
  mocks.post.mockRejectedValue(new Error('Unexpected POST'))
  mocks.delete.mockRejectedValue(new Error('Unexpected DELETE'))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  Object.values(mocks).forEach((mock) => mock.mockReset())
  await rm(directory, { recursive: true, force: true })
})

describe('storage configuration compare-and-set', () => {
  it.each([
    { policyVersion: 0, configMapVersion: 0 },
    { policyVersion: 17, configMapVersion: 32 },
    { policyVersion: Number.MAX_SAFE_INTEGER, configMapVersion: Number.MAX_SAFE_INTEGER - 1 },
  ])('forwards authoritative snapshot versions unchanged: $policyVersion / $configMapVersion', async (versions) => {
    const initial = snapshot({ ...versions, configMapName: 'authoritative-config' })
    const backend = installBackend(initial)
    await setBucket()
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { ...initial.config, bucket: 'new-bucket' } })
    expect(backend.state.config).toEqual({ ...initial.config, bucket: 'new-bucket' })
    expectSafeRequests()
    expectNoSecrets()
  })

  it.each(['policyVersion', 'configMapName'] as const)('rejects $0 changes between loading the policy schema and its configuration snapshot', async (field) => {
    const initial = snapshot()
    const backend = installBackend(initial)
    const originalGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (path: string) => {
      if (path === configurationPath) {
        if (field === 'policyVersion') {
          backend.policy.metadata.version = initial.policyVersion + 1
          backend.policy.spec.templateName = 's3os-new-template'
          backend.state.policyVersion = initial.policyVersion + 1
        } else {
          backend.policy.spec.configMapName = 'rebound-config'
          backend.state.configMapName = 'rebound-config'
        }
      }
      return originalGet(path)
    })
    const error = await failure(setBucket())
    expect(error.message).toContain('读取期间已更新')
    expect(mocks.put).not.toHaveBeenCalled()
    expect(backend.state.config).toEqual(initial.config)
    if (field === 'policyVersion') expect(backend.policy.spec.templateName).toBe('s3os-new-template')
    expectSafeRequests()
    expectNoSecrets(error)
  })

  it.each([
    { replace: false, wrapped: false },
    { replace: false, wrapped: true },
    { replace: true, wrapped: false },
    { replace: true, wrapped: true },
  ])('imports with CAS expectations (replace=$replace, wrapped=$wrapped) and accepts an empty 204 response', async ({ replace, wrapped }) => {
    const initial = snapshot()
    const backend = installBackend(initial)
    const imported = { bucket: 'imported-bucket', accessSecret: importedSecret }
    const file = join(directory, 'config.json')
    await writeFile(file, JSON.stringify(wrapped ? { default: imported } : imported))
    await main(['node', 'halo-cli', 'storage', 'config-import', 's3-personal', '--file', file, '--json', ...(replace ? ['--replace', '--yes'] : [])])
    const config = replace ? imported : { ...initial.config, ...imported }
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config })
    expect(backend.state.config).toEqual(config)
    expectSafeRequests()
    expectNoSecrets()
  })

  it.each([
    { command: 'config', dryRun: false, replace: false, writes: false },
    { command: 'config-export', dryRun: false, replace: false, writes: false },
    { command: 'config-set', dryRun: false, replace: false, writes: true },
    { command: 'config-import', dryRun: false, replace: false, writes: true },
    { command: 'config-import', dryRun: false, replace: true, writes: true },
    { command: 'config-set', dryRun: true, replace: false, writes: false },
    { command: 'config-import', dryRun: true, replace: false, writes: false },
  ])('reads the safe API for an unbound policy: $command (dryRun=$dryRun, replace=$replace)', async ({ command, dryRun, replace, writes }) => {
    const initial = snapshot({ configMapName: null, configMapVersion: null, config: {} })
    const backend = installBackend(initial)
    const file = join(directory, 'config.json')
    const output = join(directory, 'export.json')
    await writeFile(file, JSON.stringify({ bucket: 'new-bucket' }))
    const args = command === 'config-set' ? ['/default/bucket', 'new-bucket']
      : command === 'config-import' ? ['--file', file, ...(replace ? ['--replace', '--yes'] : [])]
        : command === 'config-export' ? ['--output', output] : []
    await main(['node', 'halo-cli', 'storage', command, 's3-personal', ...args, '--json', ...(dryRun ? ['--dry-run'] : [])])
    expectSafeRequests()
    if (writes) {
      expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { bucket: 'new-bucket' } })
      expect(backend.state.configMapName).toBe('new-s3-config')
      expect(backend.state.config).toEqual({ bucket: 'new-bucket' })
    } else {
      expect(mocks.put).not.toHaveBeenCalled()
      expect(backend.state).toEqual(initial)
    }
    if (command === 'config') expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('"default": {}'))
    if (command === 'config-export') expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ default: {} })
    expectNoSecrets()
  })

  it('keeps a bound but empty ConfigMap distinct from an unbound policy', async () => {
    const initial = snapshot({ configMapName: 'empty-config', configMapVersion: 0, config: {} })
    installBackend(initial)
    await setBucket()
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { bucket: 'new-bucket' } })
    expectSafeRequests()
  })

  it('rejects a stale bucket edit after a concurrent secret rotation and preserves the rotated secret', async () => {
    const initial = snapshot()
    const backend = installBackend(initial)
    backend.beforeWrite = () => {
      backend.state.configMapVersion = initial.configMapVersion! + 1
      backend.state.config.accessSecret = rotatedSecret
    }
    const error = await failure(setBucket())
    expect(error.message).toContain('409')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { ...initial.config, bucket: 'new-bucket' } })
    expect(backend.state).toEqual({ ...initial, configMapVersion: initial.configMapVersion! + 1, config: { ...initial.config, accessSecret: rotatedSecret } })
    expectSafeRequests()
    expectNoSecrets(error)
  })

  it('allows one writer to rotate a secret but rejects a second writer holding the old snapshot', async () => {
    const initial = snapshot()
    const backend = installBackend(initial)
    const http = { get: mocks.get, put: mocks.put } as unknown as AxiosInstance
    const first = await loadStorageConfiguration(http, 's3-personal')
    const stale = await loadStorageConfiguration(http, 's3-personal')
    await first.write({ default: { ...(first.current.default as Record<string, unknown>), accessSecret: rotatedSecret } })
    const error = await failure(stale.write({ default: { ...(stale.current.default as Record<string, unknown>), bucket: 'stale-bucket' } }))
    expect(error.message).toContain('409')
    expect(mocks.put).toHaveBeenCalledTimes(2)
    expect(mocks.put).toHaveBeenNthCalledWith(1, configurationPath, { ...initial, config: { ...initial.config, accessSecret: rotatedSecret } })
    expect(mocks.put).toHaveBeenNthCalledWith(2, configurationPath, { ...initial, config: { ...initial.config, bucket: 'stale-bucket' } })
    expect(backend.state.config).toEqual({ ...initial.config, accessSecret: rotatedSecret })
    expect(backend.state.configMapVersion).toBe(initial.configMapVersion! + 1)
    expectSafeRequests([...readPaths, ...readPaths])
    expectNoSecrets(error)
  })

  it.each(['policyVersion', 'configMapName'] as const)('rejects a concurrent change to $0 even when the ConfigMap version is unchanged', async (field) => {
    const initial = snapshot()
    const backend = installBackend(initial)
    backend.beforeWrite = () => {
      if (field === 'policyVersion') backend.state.policyVersion += 1
      else backend.state.configMapName = 'rebound-config'
    }
    const error = await failure(setBucket())
    expect(error.message).toContain('409')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { ...initial.config, bucket: 'new-bucket' } })
    expect(backend.state.configMapVersion).toBe(initial.configMapVersion)
    expect(backend.state.config).toEqual(initial.config)
    expectSafeRequests()
    expectNoSecrets(error)
  })

  it('rejects initialization if another writer binds the policy after the null snapshot was read', async () => {
    const initial = snapshot({ configMapName: null, configMapVersion: null, config: {} })
    const backend = installBackend(initial)
    const concurrent = snapshot({ policyVersion: initial.policyVersion + 1, configMapName: 'concurrent-config', config: { bucket: 'concurrent-bucket', accessSecret: rotatedSecret } })
    backend.beforeWrite = () => { backend.state = structuredClone(concurrent) }
    const error = await failure(setBucket())
    expect(error.message).toContain('409')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { bucket: 'new-bucket' } })
    expect(backend.state).toEqual(concurrent)
    expectSafeRequests()
    expectNoSecrets(error)
  })
})

describe('storage configuration fails closed', () => {
  it.each([
    { label: 'a sibling group', updated: { default: { bucket: 'new-bucket' }, other: { accessSecret: importedSecret } } },
    { label: 'only a different group', updated: { other: { bucket: 'new-bucket' } } },
    { label: 'no default group', updated: {} },
    { label: 'a null default group', updated: { default: null } },
    { label: 'an array default group', updated: { default: [] } },
    { label: 'a scalar default group', updated: { default: 'new-bucket' } },
  ])('rejects an updated document with $label before making a PUT', async ({ updated }) => {
    const initial = snapshot()
    const backend = installBackend(initial)
    const http = { get: mocks.get, put: mocks.put } as unknown as AxiosInstance
    const target = await loadStorageConfiguration(http, 's3-personal')
    const error = await failure(target.write(updated))
    expect(error.message).toContain('default')
    expect(mocks.put).not.toHaveBeenCalled()
    expect(backend.state).toEqual(initial)
    expectSafeRequests()
    expectNoSecrets(error)
  })

  it('leaves shared ConfigMap enforcement to the server and sanitizes its 409 response without retrying', async () => {
    const initial = snapshot()
    const backend = installBackend(initial)
    mocks.put.mockRejectedValue(Object.assign(apiError(409), {
      response: { status: 409, data: { detail: `ConfigMap shared with another-policy: accessSecret=${oldSecret}` } },
    }))
    const error = await failure(setBucket())
    expect(error.message).toContain('409')
    expect(error.message).not.toContain('another-policy')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configurationPath, { ...initial, config: { ...initial.config, bucket: 'new-bucket' } })
    expect(backend.state).toEqual(initial)
    expectSafeRequests()
    expectNoSecrets(error)
  })

  it.each([
    { label: 'missing policy version', overrides: { policyVersion: undefined } },
    { label: 'null policy version', overrides: { policyVersion: null } },
    { label: 'string policy version', overrides: { policyVersion: '7' } },
    { label: 'fractional policy version', overrides: { policyVersion: 1.5 } },
    { label: 'unsafe policy version', overrides: { policyVersion: Number.MAX_SAFE_INTEGER + 1 } },
    { label: 'missing ConfigMap name', overrides: { configMapName: undefined } },
    { label: 'empty ConfigMap name', overrides: { configMapName: '' } },
    { label: 'missing ConfigMap version', overrides: { configMapVersion: undefined } },
    { label: 'null version for a bound ConfigMap', overrides: { configMapVersion: null } },
    { label: 'string ConfigMap version', overrides: { configMapVersion: '23' } },
    { label: 'fractional ConfigMap version', overrides: { configMapVersion: 2.5 } },
    { label: 'unsafe ConfigMap version', overrides: { configMapVersion: Number.MAX_SAFE_INTEGER + 1 } },
    { label: 'version without an association', overrides: { configMapName: null, configMapVersion: 23 } },
    { label: 'unbound policy missing its version', overrides: { policyVersion: undefined, configMapName: null, configMapVersion: null, config: {} } },
    { label: 'unbound policy missing its null ConfigMap version', overrides: { configMapName: null, configMapVersion: undefined, config: {} } },
    { label: 'missing config', overrides: { config: undefined } },
    { label: 'null config', overrides: { config: null } },
    { label: 'array config', overrides: { config: [] } },
  ])('refuses to write a snapshot with $label', async ({ overrides }) => {
    const backend = installBackend()
    const initial = structuredClone(backend.state)
    const originalGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (path: string) => path === configurationPath
      ? { data: { ...initial, ...overrides } } : originalGet(path))
    const error = await failure(setBucket())
    expect(error.message).toMatch(/版本|version/u)
    expect(mocks.put).not.toHaveBeenCalled()
    expect(backend.state).toEqual(initial)
    expectSafeRequests()
    expectNoSecrets(error)
  })

  describe.each([false, true])('old plugin with unbound=%s', (unbound) => {
    it.each([
      { method: 'GET', status: 404 }, { method: 'GET', status: 405 }, { method: 'GET', status: 501 },
      { method: 'PUT', status: 404 }, { method: 'PUT', status: 405 }, { method: 'PUT', status: 501 },
    ])('requires an upgrade for $method HTTP $status without falling back', async ({ method, status }) => {
      const initial = unbound ? snapshot({ configMapName: null, configMapVersion: null, config: {} }) : snapshot()
      const backend = installBackend(initial)
      if (method === 'GET') {
        const originalGet = mocks.get.getMockImplementation()!
        mocks.get.mockImplementation(async (path: string) => {
          if (path === configurationPath) throw apiError(status)
          return originalGet(path)
        })
      } else mocks.put.mockRejectedValue(apiError(status))
      const error = await failure(setBucket())
      expect(error.message).toMatch(/升级/u)
      expect(mocks.put).toHaveBeenCalledTimes(method === 'PUT' ? 1 : 0)
      expect(backend.state).toEqual(initial)
      expectSafeRequests()
      expectNoSecrets(error)
    })
  })

  describe.each(['GET', 'PUT'])('%s failures', (method) => {
    it.each([400, 401, 403, 409, 422, 500, undefined])('sanitizes HTTP %s without retrying or falling back', async (status) => {
      const initial = snapshot()
      const backend = installBackend(initial)
      if (method === 'GET') {
        const originalGet = mocks.get.getMockImplementation()!
        mocks.get.mockImplementation(async (path: string) => {
          if (path === configurationPath) throw apiError(status)
          return originalGet(path)
        })
      } else mocks.put.mockRejectedValue(apiError(status))
      const error = await failure(setBucket())
      if (status === 401) expect(error.message).toContain('认证')
      else if (status === 403) expect(error.message).toContain('权限')
      else if (status !== undefined) expect(error.message).toContain(String(status))
      expect(mocks.put).toHaveBeenCalledTimes(method === 'PUT' ? 1 : 0)
      expect(backend.state).toEqual(initial)
      expectSafeRequests()
      expectNoSecrets(error)
    })
  })
})
