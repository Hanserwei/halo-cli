import { AxiosError, AxiosHeaders } from 'axios'
import { effectScope } from 'vue'
import type { EffectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AccessKey,
  AccessKeyApi,
  AccessKeySecret,
  CreateAccessKeyRequest,
  Scope,
} from '../../api/types'
import { useAccessKeys } from '../use-access-keys'

// Keep mocks tied to the named API contract, including metadata-only list results.
function mockApi() {
  return {
    listKeys: vi.fn<AccessKeyApi['listKeys']>().mockResolvedValue([]),
    listScopes: vi.fn<AccessKeyApi['listScopes']>().mockResolvedValue(scopes),
    createKey: vi.fn<AccessKeyApi['createKey']>(),
    updateKey: vi.fn<AccessKeyApi['updateKey']>(),
    rotateKey: vi.fn<AccessKeyApi['rotateKey']>(),
    deleteKey: vi.fn<AccessKeyApi['deleteKey']>().mockResolvedValue(undefined),
  } satisfies AccessKeyApi
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function metadata(overrides: Partial<AccessKey> = {}): AccessKey {
  return {
    name: 'deploy-key',
    displayName: 'Deploy',
    keyPrefix: 'cli_test',
    ownerName: 'admin',
    scopes: ['posts:read'],
    enabled: true,
    allowedIpRanges: [],
    expiresAt: null,
    ...overrides,
  }
}

const scopes: Scope[] = [
  { name: 'posts:read', displayName: 'Read posts', description: 'List and read posts' },
]
const request: CreateAccessKeyRequest = {
  displayName: 'Deploy',
  scopes: ['posts:read'],
  allowedIpRanges: [],
  expiresAt: null,
}
const effectScopes: EffectScope[] = []

function setup(api: AccessKeyApi) {
  const scope = effectScope()
  effectScopes.push(scope)
  const store = scope.run(() => useAccessKeys(api))!
  return { store, scope }
}

function expectMetadataOnly(keys: AccessKey[]) {
  for (const key of keys) {
    expect(key).not.toHaveProperty('token')
    expect(key).not.toHaveProperty('key')
  }
}

afterEach(() => {
  for (const scope of effectScopes.splice(0)) scope.stop()
})

describe('useAccessKeys independent disable', () => {
  it.each([null, '2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])(
    'preserves existing fields and expiry %s when scopes are unavailable',
    async (expiresAt) => {
      const api = mockApi()
      const key = metadata({
        displayName: 'Existing deployment',
        scopes: ['posts:read', 'legacy:scope'],
        allowedIpRanges: ['192.0.2.0/24', '2001:db8::/32'],
        expiresAt,
      })
      api.listKeys.mockResolvedValue([key])
      api.listScopes.mockRejectedValue(new Error('scope catalog unavailable'))
      api.updateKey.mockResolvedValue({ ...key, enabled: false })
      const { store } = setup(api)
      await store.load()

      expect(store.scopesReady.value).toBe(false)
      expect(store.scopeError.value).not.toBe('')
      expect(await store.update(key.name, { ...request, enabled: false })).toBe(false)
      expect(api.updateKey).not.toHaveBeenCalled()
      expect(await store.disable(key.name)).toBe(true)

      expect(api.updateKey).toHaveBeenCalledExactlyOnceWith(key.name, {
        displayName: key.displayName,
        scopes: key.scopes,
        allowedIpRanges: key.allowedIpRanges,
        expiresAt,
        enabled: false,
      })
      expect(store.keys.value).toEqual([{ ...key, enabled: false }])
      expect(store.secret.value).toBeUndefined()
      expect(store.busy.value).toBe('')
      expectMetadataOnly(store.keys.value)
    },
  )
})

describe('useAccessKeys loading', () => {
  it('distinguishes pending loading from a successful empty list', async () => {
    const api = mockApi()
    const pendingKeys = deferred<AccessKey[]>()
    const pendingScopes = deferred<Scope[]>()
    api.listKeys.mockReturnValue(pendingKeys.promise)
    api.listScopes.mockReturnValue(pendingScopes.promise)
    const { store } = setup(api)

    expect(store.loading.value).toBe(false)
    expect(store.scopesReady.value).toBe(false)
    const loading = store.load()
    expect(store.loading.value).toBe(true)
    expect(api.listKeys).toHaveBeenCalledTimes(1)
    expect(api.listScopes).toHaveBeenCalledTimes(1)
    expect(await store.create(request)).toBe(false)
    expect(await store.update('deploy-key', { ...request, enabled: false })).toBe(false)
    expect(api.createKey).not.toHaveBeenCalled()
    expect(api.updateKey).not.toHaveBeenCalled()

    pendingKeys.resolve([])
    pendingScopes.resolve(scopes)
    await loading

    expect(store.loading.value).toBe(false)
    expect(store.keys.value).toEqual([])
    expect(store.scopes.value).toEqual(scopes)
    expect(store.scopesReady.value).toBe(true)
    expect(store.listError.value).toBe('')
    expect(store.scopeError.value).toBe('')
    expect(store.secret.value).toBeUndefined()
  })

  it('loads only metadata and never reconstructs a secret from list results', async () => {
    const api = mockApi()
    const key = metadata()
    api.listKeys.mockResolvedValue([key])
    const { store } = setup(api)

    await store.load()
    await store.load()

    expect(store.keys.value).toEqual([key])
    expectMetadataOnly(store.keys.value)
    expect(store.secret.value).toBeUndefined()
  })

  it('exposes list failure separately from an empty success and clears it on retry', async () => {
    const api = mockApi()
    api.listKeys.mockResolvedValueOnce([metadata()])
    const { store } = setup(api)
    await store.load()
    api.listKeys.mockRejectedValueOnce(new Error('private server response'))

    await store.load()

    expect(store.loading.value).toBe(false)
    expect(store.keys.value).toEqual([])
    expect(store.listError.value).toBe('密钥列表加载失败，请重试。')
    expect(store.scopesReady.value).toBe(true)
    expect(store.scopeError.value).toBe('')

    await store.load()
    expect(store.keys.value).toEqual([])
    expect(store.listError.value).toBe('')
  })

  it('keeps keys visible when scopes fail and blocks create/edit until scopes recover', async () => {
    const api = mockApi()
    const key = metadata()
    api.listKeys.mockResolvedValue([key])
    const { store } = setup(api)
    await store.load()
    api.listScopes.mockRejectedValueOnce(new Error('scope service unavailable'))

    await store.load()

    expect(store.keys.value).toEqual([key])
    expectMetadataOnly(store.keys.value)
    expect(store.loading.value).toBe(false)
    expect(store.listError.value).toBe('')
    expect(store.scopes.value).toEqual([])
    expect(store.scopesReady.value).toBe(false)
    expect(store.scopeError.value).toBe('权限范围加载失败，创建和编辑已禁用。')
    expect(await store.create(request)).toBe(false)
    expect(await store.update(key.name, { ...request, enabled: false })).toBe(false)
    expect(api.createKey).not.toHaveBeenCalled()
    expect(api.updateKey).not.toHaveBeenCalled()

    await store.load()
    expect(store.scopesReady.value).toBe(true)
    expect(store.scopeError.value).toBe('')
    api.updateKey.mockResolvedValue({ ...key, enabled: false })
    expect(await store.update(key.name, { ...request, enabled: false })).toBe(true)
    expect(store.keys.value[0]?.enabled).toBe(false)
  })

  it('reports both independent loading failures and settles loading', async () => {
    const api = mockApi()
    api.listKeys.mockRejectedValue(new Error('list failure'))
    api.listScopes.mockRejectedValue(new Error('scope failure'))
    const { store } = setup(api)

    await store.load()

    expect(store.keys.value).toEqual([])
    expect(store.scopes.value).toEqual([])
    expect(store.loading.value).toBe(false)
    expect(store.scopesReady.value).toBe(false)
    expect(store.listError.value).not.toBe('')
    expect(store.scopeError.value).not.toBe('')
  })
})

describe.each(['create', 'rotate'] as const)('useAccessKeys %s secrets', (operation) => {
  it('exposes the secret once, keeps list entries metadata-only and clears it on close', async () => {
    const api = mockApi()
    const key = metadata()
    const other = metadata({ name: 'other-key' })
    api.listKeys.mockResolvedValue(operation === 'create' ? [other] : [key, other])
    const issued: AccessKeySecret = {
      key: { ...key, keyPrefix: 'cli_new' },
      token: `${operation}-one-time-secret`,
    }
    api.createKey.mockResolvedValue(issued)
    api.rotateKey.mockResolvedValue(issued)
    const { store } = setup(api)
    await store.load()

    const success = operation === 'create' ? await store.create(request) : await store.rotate(key.name)

    expect(success).toBe(true)
    expect(store.secret.value).toBe(issued)
    expect(store.busy.value).toBe('')
    expect(store.keys.value).toEqual([issued.key, other])
    expectMetadataOnly(store.keys.value)
    if (operation === 'create') {
      expect(api.createKey).toHaveBeenCalledExactlyOnceWith(request)
    } else {
      expect(api.rotateKey).toHaveBeenCalledExactlyOnceWith(key.name)
    }

    // An open secret must not be overwritten by another mutation.
    expect(await store.create(request)).toBe(false)
    expect(await store.rotate(key.name)).toBe(false)
    expect(await store.update(key.name, { ...request, enabled: false })).toBe(false)
    expect(await store.remove(key.name)).toBe(false)
    expect(api.createKey).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0)
    expect(api.rotateKey).toHaveBeenCalledTimes(operation === 'rotate' ? 1 : 0)
    expect(api.updateKey).not.toHaveBeenCalled()
    expect(api.deleteKey).not.toHaveBeenCalled()

    store.dismissSecret()
    expect(store.secret.value).toBeUndefined()
    expect(store.keys.value).toEqual([issued.key, other])
    api.listKeys.mockResolvedValue([issued.key, other])
    await store.load()
    expect(store.secret.value).toBeUndefined()
    expectMetadataOnly(store.keys.value)
    expect(JSON.stringify(store.keys.value)).not.toContain(issued.token)
  })

  it('clears an already displayed secret when its Vue scope is destroyed', async () => {
    const api = mockApi()
    const issued: AccessKeySecret = { key: metadata(), token: 'visible-secret' }
    api.listKeys.mockResolvedValue([issued.key])
    api.createKey.mockResolvedValue(issued)
    api.rotateKey.mockResolvedValue(issued)
    const { store, scope } = setup(api)
    await store.load()
    if (operation === 'create') await store.create(request)
    else await store.rotate(issued.key.name)
    expect(store.secret.value).toBe(issued)

    scope.stop()

    expect(store.secret.value).toBeUndefined()
    expect(store.keys.value).toEqual([])
    expect(store.scopes.value).toEqual([])
  })

  it.each(['dispose', 'scope'] as const)(
    'does not restore a secret from a late success after %s destruction',
    async (destruction) => {
      const api = mockApi()
      const pending = deferred<AccessKeySecret>()
      const key = metadata()
      api.listKeys.mockResolvedValue([key])
      api.createKey.mockReturnValue(pending.promise)
      api.rotateKey.mockReturnValue(pending.promise)
      const { store, scope } = setup(api)
      await store.load()
      const mutation = operation === 'create' ? store.create(request) : store.rotate(key.name)
      expect(store.busy.value).not.toBe('')

      if (destruction === 'dispose') store.dispose()
      else scope.stop()
      pending.resolve({ key, token: 'late-secret-must-not-return' })

      expect(await mutation).toBe(false)
      expect(store.secret.value).toBeUndefined()
      expect(store.keys.value).toEqual([])
      expect(store.scopes.value).toEqual([])
      expect(store.busy.value).toBe('')
      expect(await store.create(request)).toBe(false)
      expect(await store.rotate(key.name)).toBe(false)
      expect(api.createKey).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0)
      expect(api.rotateKey).toHaveBeenCalledTimes(operation === 'rotate' ? 1 : 0)
    },
  )

  it('uses a safe uncertain-outcome error for a timeout without exposing credentials or responses', async () => {
    const api = mockApi()
    const credential = 'raw-authorization-credential'
    const responseToken = 'raw-response-token'
    const responseDetail = 'private-response-detail'
    const config = {
      headers: new AxiosHeaders({ Authorization: `Bearer ${credential}` }),
      data: JSON.stringify({ token: credential }),
    }
    const error = new AxiosError(
      `timeout ${credential} ${responseDetail}`,
      'ECONNABORTED',
      config,
      { rawCredential: credential },
      {
        status: 504,
        statusText: 'Gateway Timeout',
        data: { token: responseToken, detail: responseDetail },
        headers: {},
        config,
      },
    )
    api.listKeys.mockResolvedValue([metadata()])
    api.createKey.mockRejectedValue(error)
    api.rotateKey.mockRejectedValue(error)
    const { store } = setup(api)
    await store.load()

    const success = operation === 'create' ? await store.create(request) : await store.rotate('deploy-key')

    expect(success).toBe(false)
    expect(store.mutationError.value).toBe(
      operation === 'create'
        ? '创建未能确认成功，请先刷新列表再决定是否重试。'
        : '轮换未能确认成功，请先检查密钥状态再重试。',
    )
    for (const sensitive of [credential, responseToken, responseDetail, error.message]) {
      expect(store.mutationError.value).not.toContain(sensitive)
    }
    expect(store.secret.value).toBeUndefined()
    expect(store.keys.value).toEqual([metadata()])
    expectMetadataOnly(store.keys.value)
    expect(store.busy.value).toBe('')
    expect(api.createKey).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0)
    expect(api.rotateKey).toHaveBeenCalledTimes(operation === 'rotate' ? 1 : 0)
  })
})

describe('useAccessKeys mutation serialization', () => {
  it.each(['create', 'update', 'rotate', 'remove'] as const)(
    'blocks duplicate and competing dangerous requests while %s is busy',
    async (operation) => {
      const api = mockApi()
      const key = metadata()
      const issued: AccessKeySecret = { key, token: 'pending-secret' }
      const pendingSecret = deferred<AccessKeySecret>()
      const pendingUpdate = deferred<AccessKey>()
      const pendingDelete = deferred<void>()
      api.listKeys.mockResolvedValue([key])
      api.createKey.mockReturnValue(pendingSecret.promise)
      api.rotateKey.mockReturnValue(pendingSecret.promise)
      api.updateKey.mockReturnValue(pendingUpdate.promise)
      api.deleteKey.mockReturnValue(pendingDelete.promise)
      const { store } = setup(api)
      await store.load()
      const update = { ...request, enabled: false }
      const pending =
        operation === 'create'
          ? store.create(request)
          : operation === 'update'
            ? store.update(key.name, update)
            : operation === 'rotate'
              ? store.rotate(key.name)
              : store.remove(key.name)

      expect(store.busy.value).toBe(operation === 'create' ? 'create' : key.name)
      expect(await store.create(request)).toBe(false)
      expect(await store.update(key.name, update)).toBe(false)
      expect(await store.rotate(key.name)).toBe(false)
      expect(await store.remove(key.name)).toBe(false)
      await store.load()
      expect(api.listKeys).toHaveBeenCalledTimes(1)
      expect(api.listScopes).toHaveBeenCalledTimes(1)
      expect(api.createKey).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0)
      expect(api.updateKey).toHaveBeenCalledTimes(operation === 'update' ? 1 : 0)
      expect(api.rotateKey).toHaveBeenCalledTimes(operation === 'rotate' ? 1 : 0)
      expect(api.deleteKey).toHaveBeenCalledTimes(operation === 'remove' ? 1 : 0)

      if (operation === 'create' || operation === 'rotate') pendingSecret.resolve(issued)
      else if (operation === 'update') pendingUpdate.resolve({ ...key, enabled: false })
      else pendingDelete.resolve(undefined)
      expect(await pending).toBe(true)
      expect(store.busy.value).toBe('')
      expectMetadataOnly(store.keys.value)
      if (operation === 'update') {
        expect(api.updateKey).toHaveBeenCalledExactlyOnceWith(key.name, update)
        expect(store.keys.value[0]?.enabled).toBe(false)
      }
      if (operation === 'remove') {
        expect(api.deleteKey).toHaveBeenCalledExactlyOnceWith(key.name)
        expect(store.keys.value).toEqual([])
      }
    },
  )
})
