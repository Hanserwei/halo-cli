import { isAxiosError } from 'axios'
import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { accessKeyApi } from '../api/access-keys'
import type {
  AccessKey,
  AccessKeyApi,
  AccessKeySecret,
  CreateAccessKeyRequest,
  Scope,
  UpdateAccessKeyRequest,
} from '../api/types'

export interface AccessKeyStore {
  keys: Ref<AccessKey[]>
  scopes: Ref<Scope[]>
  loading: Ref<boolean>
  scopesReady: Ref<boolean>
  listError: Ref<string>
  scopeError: Ref<string>
  mutationError: Ref<string>
  busy: Ref<string>
  secret: ShallowRef<AccessKeySecret | undefined>
  load(): Promise<void>
  create(request: CreateAccessKeyRequest): Promise<boolean>
  update(name: string, request: UpdateAccessKeyRequest): Promise<boolean>
  disable(name: string): Promise<boolean>
  rotate(name: string): Promise<boolean>
  remove(name: string): Promise<boolean>
  dismissSecret(): void
  dispose(): void
}

function failureMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    switch (error.response?.status) {
      case 401:
        return '登录已失效，请重新登录后重试。'
      case 403:
        return '没有执行此操作的权限，请联系管理员。'
      case 404:
        return '密钥不存在或插件接口不可用，请刷新列表。'
      case 409:
        return '密钥状态已变化，请刷新列表后重试。'
    }
  }
  // Do not display response bodies: a failed request may contain credentials.
  return fallback
}

export function useAccessKeys(api: AccessKeyApi = accessKeyApi): AccessKeyStore {
  const keys = ref<AccessKey[]>([])
  const scopes = ref<Scope[]>([])
  const loading = ref(false)
  const scopesReady = ref(false)
  const listError = ref('')
  const scopeError = ref('')
  const mutationError = ref('')
  const busy = ref('')
  const secret = shallowRef<AccessKeySecret>()
  let disposed = false
  let loadVersion = 0

  async function load() {
    if (disposed || busy.value) return
    const version = ++loadVersion
    loading.value = true
    listError.value = ''
    scopeError.value = ''
    scopesReady.value = false
    const [keyResult, scopeResult] = await Promise.allSettled([api.listKeys(), api.listScopes()])
    if (disposed || version !== loadVersion) return
    if (keyResult.status === 'fulfilled') {
      keys.value = keyResult.value
    } else {
      keys.value = []
      listError.value = failureMessage(keyResult.reason, '密钥列表加载失败，请重试。')
    }
    if (scopeResult.status === 'fulfilled') {
      scopes.value = scopeResult.value
      scopesReady.value = true
    } else {
      scopes.value = []
      scopeError.value = failureMessage(scopeResult.reason, '权限范围加载失败，创建和编辑已禁用。')
    }
    loading.value = false
  }

  async function create(request: CreateAccessKeyRequest) {
    if (disposed || busy.value || loading.value || secret.value || !scopesReady.value) return false
    busy.value = 'create'
    mutationError.value = ''
    try {
      const result = await api.createKey(request)
      if (disposed) return false
      keys.value = [result.key, ...keys.value.filter((key) => key.name !== result.key.name)]
      secret.value = result
      return true
    } catch (error) {
      if (!disposed) {
        mutationError.value = failureMessage(error, '创建未能确认成功，请先刷新列表再决定是否重试。')
      }
      return false
    } finally {
      busy.value = ''
    }
  }

  async function update(name: string, request: UpdateAccessKeyRequest) {
    if (disposed || busy.value || loading.value || secret.value || !scopesReady.value) return false
    busy.value = name
    mutationError.value = ''
    try {
      const result = await api.updateKey(name, request)
      if (disposed) return false
      keys.value = keys.value.map((key) => (key.name === name ? result : key))
      return true
    } catch (error) {
      if (!disposed) mutationError.value = failureMessage(error, '保存失败，请检查输入后重试。')
      return false
    } finally {
      busy.value = ''
    }
  }

  async function disable(name: string) {
    if (disposed || busy.value || loading.value || secret.value) return false
    const current = keys.value.find((key) => key.name === name)
    if (!current || !current.enabled) return false
    busy.value = name
    mutationError.value = ''
    try {
      const result = await api.updateKey(name, {
        displayName: current.displayName,
        scopes: [...current.scopes],
        allowedIpRanges: [...current.allowedIpRanges],
        expiresAt: current.expiresAt ?? null,
        enabled: false,
      })
      if (disposed) return false
      keys.value = keys.value.map((key) => (key.name === name ? result : key))
      return true
    } catch (error) {
      if (!disposed) mutationError.value = failureMessage(error, '禁用失败，请刷新列表确认状态。')
      return false
    } finally {
      busy.value = ''
    }
  }

  async function rotate(name: string) {
    if (disposed || busy.value || loading.value || secret.value) return false
    busy.value = name
    mutationError.value = ''
    try {
      const result = await api.rotateKey(name)
      if (disposed) return false
      keys.value = keys.value.map((key) => (key.name === name ? result.key : key))
      secret.value = result
      return true
    } catch (error) {
      if (!disposed) {
        mutationError.value = failureMessage(error, '轮换未能确认成功，请先检查密钥状态再重试。')
      }
      return false
    } finally {
      busy.value = ''
    }
  }

  async function remove(name: string) {
    if (disposed || busy.value || loading.value || secret.value) return false
    busy.value = name
    mutationError.value = ''
    try {
      await api.deleteKey(name)
      if (disposed) return false
      keys.value = keys.value.filter((key) => key.name !== name)
      return true
    } catch (error) {
      if (!disposed) mutationError.value = failureMessage(error, '删除失败，请刷新列表确认状态。')
      return false
    } finally {
      busy.value = ''
    }
  }

  function dismissSecret() {
    secret.value = undefined
  }

  function dispose() {
    disposed = true
    ++loadVersion
    secret.value = undefined
    keys.value = []
    scopes.value = []
  }

  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    keys,
    scopes,
    loading,
    scopesReady,
    listError,
    scopeError,
    mutationError,
    busy,
    secret,
    load,
    create,
    update,
    disable,
    rotate,
    remove,
    dismissSecret,
    dispose,
  }
}
