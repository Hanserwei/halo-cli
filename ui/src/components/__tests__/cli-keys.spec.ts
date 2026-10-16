import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessKey } from '../../api/types'
import type { AccessKeyStore } from '../../composables/use-access-keys'
import CliAccessKeys from '../CliAccessKeys.vue'
import CliKeyFormModal from '../CliKeyFormModal.vue'
import CliKeySecretModal from '../CliKeySecretModal.vue'
import CommandBlock from '../CommandBlock.vue'

const mocks = vi.hoisted(() => ({
  useAccessKeys: vi.fn<() => AccessKeyStore>(),
  getUserPermissions: vi.fn(),
  has: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../../composables/use-access-keys', () => ({ useAccessKeys: mocks.useAccessKeys }))
vi.mock('@halo-dev/ui-shared', () => ({
  utils: { permission: { getUserPermissions: mocks.getUserPermissions, has: mocks.has } },
}))
vi.mock('@halo-dev/components', () => {
  // Native controls preserve disabled behavior; panels render the slots used by the real components.
  const Panel = {
    props: ['title', 'description', 'message', 'text'],
    template: `<section>
      <h2 v-if="title">{{ title }}</h2><p v-if="description">{{ description }}</p>
      <p v-if="message">{{ message }}</p><span v-if="text">{{ text }}</span>
      <slot name="actions" /><slot name="start" /><slot /><slot name="extra" />
      <slot name="end" /><slot name="footer" />
    </section>`,
  }
  const Button = {
    props: { disabled: Boolean, loading: Boolean, type: String },
    template: '<button type="button" :disabled="disabled || loading"><slot /></button>',
  }
  const Modal = {
    props: ['title', 'visible', 'layerClosable', 'width', 'mountToBody'],
    emits: ['close'],
    template: `<div role="dialog" :aria-label="title">
      <h2>{{ title }}</h2><button type="button" aria-label="关闭弹窗" @click="$emit('close')">关闭弹窗</button>
      <slot /><slot name="footer" />
    </div>`,
  }
  return {
    Toast: { success: mocks.success },
    VButton: Button,
    VModal: Modal,
    VAlert: Panel,
    VCard: Panel,
    VEmpty: Panel,
    VEntity: Panel,
    VEntityContainer: Panel,
    VEntityField: Panel,
    VLoading: { template: '<p role="status">加载中</p>' },
    VSpace: Panel,
    VStatusDot: Panel,
  }
})

const FormKit = defineComponent({
  props: {
    modelValue: [String, Boolean],
    type: String,
    name: String,
    label: String,
    disabled: Boolean,
  },
  emits: ['update:modelValue'],
  template: `<label>{{ label }}
    <textarea v-if="type === 'textarea'" :name="name" :disabled="disabled" :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)" />
    <input v-else :type="type" :name="name" :disabled="disabled"
      :value="modelValue" :checked="type === 'checkbox' && modelValue === true"
      @input="type !== 'checkbox' && $emit('update:modelValue', $event.target.value)"
      @change="type === 'checkbox' && $emit('update:modelValue', $event.target.checked)" />
  </label>`,
})
const global = { components: { FormKit } }
const wrappers: VueWrapper[] = []

function key(overrides: Partial<AccessKey> = {}): AccessKey {
  return {
    name: 'deployment-key',
    displayName: 'Deployment',
    keyPrefix: 'cli_public_prefix',
    ownerName: 'administrator',
    scopes: ['posts:read'],
    enabled: true,
    allowedIpRanges: ['192.0.2.0/24'],
    expiresAt: null,
    ...overrides,
  }
}

function mockStore(): AccessKeyStore {
  const store: AccessKeyStore = {
    keys: ref([key()]),
    scopes: ref([{ name: 'posts:read', displayName: 'Read posts', description: 'Read articles' }]),
    loading: ref(false),
    scopesReady: ref(true),
    listError: ref(''),
    scopeError: ref(''),
    mutationError: ref(''),
    busy: ref(''),
    secret: shallowRef(),
    load: vi.fn<AccessKeyStore['load']>().mockResolvedValue(undefined),
    create: vi.fn<AccessKeyStore['create']>().mockResolvedValue(true),
    update: vi.fn<AccessKeyStore['update']>().mockResolvedValue(true),
    disable: vi.fn<AccessKeyStore['disable']>().mockResolvedValue(true),
    rotate: vi.fn<AccessKeyStore['rotate']>().mockResolvedValue(true),
    remove: vi.fn<AccessKeyStore['remove']>().mockResolvedValue(true),
    dismissSecret: vi.fn<AccessKeyStore['dismissSecret']>(() => { store.secret.value = undefined }),
    dispose: vi.fn<AccessKeyStore['dispose']>(),
  }
  return store
}

function renderKeys(store = mockStore()) {
  mocks.useAccessKeys.mockReturnValue(store)
  const wrapper = mount(CliAccessKeys, { global })
  wrappers.push(wrapper)
  return { wrapper, store }
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

function disabled(wrapper: VueWrapper, text: string) {
  return (button(wrapper, text).element as HTMLButtonElement).disabled
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserPermissions.mockReturnValue(['plugin:halo-cli:keys:manage'])
  mocks.has.mockReturnValue(true)
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('CLI key list interactions', () => {
  it.each(['read-only', 'permissions unavailable'])(
    'hides management actions when %s while retaining metadata', (permissionState) => {
      if (permissionState === 'read-only') mocks.has.mockReturnValue(false)
      else mocks.getUserPermissions.mockReturnValue(undefined)
      const { wrapper } = renderKeys()

      expect(wrapper.text()).toContain('当前仅可查看密钥')
      expect(wrapper.text()).toContain('Deployment')
      expect(wrapper.text()).toContain('cli_public_prefix')
      for (const action of ['创建密钥', '编辑', '禁用', '轮换', '删除']) {
        expect(wrapper.findAll('button').some((item) => item.text() === action)).toBe(false)
      }
      expect(button(wrapper, '刷新').exists()).toBe(true)
    },
  )

  it('shows the empty state and opens the real create form', async () => {
    const store = mockStore()
    store.keys.value = []
    const { wrapper } = renderKeys(store)

    expect(store.load).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('尚未创建 CLI 密钥')
    await button(wrapper, '创建密钥').trigger('click')
    expect(wrapper.findComponent(CliKeyFormModal).exists()).toBe(true)
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('创建 CLI 密钥')
    expect(disabled(wrapper, '创建')).toBe(true)
  })

  it('retries a list failure and renders recovered metadata', async () => {
    const store = mockStore()
    store.keys.value = []
    store.listError.value = '密钥列表加载失败，请重试。'
    const { wrapper } = renderKeys(store)
    expect(wrapper.text()).toContain('无法加载密钥')
    expect(wrapper.text()).not.toContain('尚未创建 CLI 密钥')

    vi.mocked(store.load).mockImplementationOnce(async () => {
      store.listError.value = ''
      store.keys.value = [key()]
    })
    await button(wrapper, '重试').trigger('click')
    await flushPromises()

    expect(store.load).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Deployment')
    expect(wrapper.text()).not.toContain('无法加载密钥')
  })

  it('preserves metadata and disables create/edit when scopes fail, then permits retry', async () => {
    const store = mockStore()
    store.scopes.value = []
    store.scopesReady.value = false
    store.scopeError.value = '权限范围加载失败，创建和编辑已禁用。'
    const { wrapper } = renderKeys(store)

    for (const metadata of ['Deployment', 'cli_public_prefix', 'administrator', 'posts:read', '192.0.2.0/24']) {
      expect(wrapper.text()).toContain(metadata)
    }
    expect(disabled(wrapper, '创建密钥')).toBe(true)
    expect(disabled(wrapper, '编辑')).toBe(true)
    expect(disabled(wrapper, '轮换')).toBe(false)
    expect(disabled(wrapper, '删除')).toBe(false)
    await button(wrapper, '创建密钥').trigger('click')
    await button(wrapper, '编辑').trigger('click')
    expect(wrapper.findComponent(CliKeyFormModal).exists()).toBe(false)
    await button(wrapper, '重试').trigger('click')
    expect(store.load).toHaveBeenCalledTimes(2)
  })

  it('allows exact-name disable confirmation when the scope catalog is unavailable', async () => {
    const store = mockStore()
    store.scopes.value = []
    store.scopesReady.value = false
    store.scopeError.value = '权限范围加载失败，创建和编辑已禁用。'
    const { wrapper } = renderKeys(store)

    expect(disabled(wrapper, '编辑')).toBe(true)
    expect(disabled(wrapper, '禁用')).toBe(false)
    await button(wrapper, '禁用').trigger('click')
    expect(disabled(wrapper, '确认禁用')).toBe(true)
    await wrapper.get('input[name="confirmName"]').setValue('deployment-key')
    expect(disabled(wrapper, '确认禁用')).toBe(true)
    await button(wrapper, '确认禁用').trigger('click')
    expect(store.disable).not.toHaveBeenCalled()
    await wrapper.get('input[name="confirmName"]').setValue('Deployment')
    expect(disabled(wrapper, '确认禁用')).toBe(false)
    await button(wrapper, '确认禁用').trigger('click')
    await flushPromises()

    expect(store.disable).toHaveBeenCalledExactlyOnceWith('deployment-key')
    expect(store.update).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('cli_public_prefix')
  })

  it.each(['busy', 'loading'] as const)('disables list actions while %s', async (state) => {
    const { wrapper, store } = renderKeys()
    if (state === 'busy') store.busy.value = 'deployment-key'
    else store.loading.value = true
    await nextTick()

    expect(disabled(wrapper, '刷新')).toBe(true)
    expect(disabled(wrapper, '创建密钥')).toBe(true)
    if (state === 'busy') {
      for (const action of ['编辑', '禁用', '轮换', '删除']) {
        expect(disabled(wrapper, action)).toBe(true)
        await button(wrapper, action).trigger('click')
      }
    } else expect(wrapper.text()).toContain('加载中')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.rotate).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'disabled', overrides: { enabled: false }, status: '已禁用' },
    { label: 'expired', overrides: { expiresAt: '2000-01-01T00:00:00Z' }, status: '已过期' },
  ])('disables rotation for a $label key', async ({ overrides, status }) => {
    const store = mockStore()
    store.keys.value = [key(overrides)]
    const { wrapper } = renderKeys(store)

    expect(wrapper.text()).toContain(status)
    expect(disabled(wrapper, '轮换')).toBe(true)
    await button(wrapper, '轮换').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.rotate).not.toHaveBeenCalled()
    expect(disabled(wrapper, '删除')).toBe(false)
  })

  it('requires the exact display name to delete and prevents submitting again while busy', async () => {
    const { wrapper, store } = renderKeys()
    await button(wrapper, '删除').trigger('click')
    expect(disabled(wrapper, '确认删除')).toBe(true)
    await wrapper.get('input[name="confirmName"]').setValue('deployment-key')
    expect(disabled(wrapper, '确认删除')).toBe(true)
    await button(wrapper, '确认删除').trigger('click')
    expect(store.remove).not.toHaveBeenCalled()
    await wrapper.get('input[name="confirmName"]').setValue('Deployment ')
    expect(disabled(wrapper, '确认删除')).toBe(true)
    await wrapper.get('input[name="confirmName"]').setValue('Deployment')
    expect(disabled(wrapper, '确认删除')).toBe(false)

    let finish!: (value: boolean) => void
    vi.mocked(store.remove).mockImplementationOnce(() => {
      store.busy.value = 'deployment-key'
      return new Promise<boolean>((resolve) => { finish = resolve })
    })
    await button(wrapper, '确认删除').trigger('click')
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('deployment-key')
    expect(disabled(wrapper, '确认删除')).toBe(true)
    expect(disabled(wrapper, '取消')).toBe(true)
    expect((wrapper.get('input[name="confirmName"]').element as HTMLInputElement).disabled).toBe(true)
    await button(wrapper, '确认删除').trigger('click')
    expect(store.remove).toHaveBeenCalledTimes(1)
    store.busy.value = ''
    finish(true)
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('submits a real edit form with enabled:false and an explicitly cleared expiry', async () => {
    const store = mockStore()
    store.keys.value = [key({ expiresAt: '2099-01-01T00:00:00Z' })]
    const { wrapper } = renderKeys(store)
    await button(wrapper, '编辑').trigger('click')
    await wrapper.get('input[name="enabled"]').setValue(false)
    await wrapper.get('input[name="expiresAt"]').setValue('')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(store.update).toHaveBeenCalledExactlyOnceWith('deployment-key', {
      displayName: 'Deployment',
      scopes: ['posts:read'],
      allowedIpRanges: ['192.0.2.0/24'],
      expiresAt: null,
      enabled: false,
    })
    expect(wrapper.findComponent(CliKeyFormModal).exists()).toBe(false)
  })

  it('allows disabling through the edit form without clearing an unchanged expired ISO timestamp', async () => {
    const store = mockStore()
    const expiresAt = '2000-01-01T12:34:56.789Z'
    store.keys.value = [key({ expiresAt })]
    const { wrapper } = renderKeys(store)

    await button(wrapper, '编辑').trigger('click')
    expect(wrapper.findComponent(CliKeyFormModal).exists()).toBe(true)
    expect((wrapper.get('input[name="expiresAt"]').element as HTMLInputElement).value).not.toBe('')
    await wrapper.get('input[name="enabled"]').setValue(false)
    expect(disabled(wrapper, '保存')).toBe(false)
    await button(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(store.update).toHaveBeenCalledExactlyOnceWith('deployment-key', {
      displayName: 'Deployment',
      scopes: ['posts:read'],
      allowedIpRanges: ['192.0.2.0/24'],
      expiresAt,
      enabled: false,
    })
    expect(wrapper.findComponent(CliKeyFormModal).exists()).toBe(false)
  })
})

describe('one-time secret interactions', () => {
  it('reports copy failure, requires acknowledgement and clears the parent secret permanently on completion', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const store = mockStore()
    const token = 'cli_once_never_in_metadata'
    store.secret.value = { key: key(), token }
    const { wrapper } = renderKeys(store)

    expect(wrapper.findComponent(CliKeySecretModal).exists()).toBe(true)
    expect((wrapper.get('#cli-key-secret').element as HTMLTextAreaElement).value).toBe(token)
    expect(disabled(wrapper, '完成')).toBe(true)
    await button(wrapper, '完成').trigger('click')
    expect(store.dismissSecret).not.toHaveBeenCalled()
    await button(wrapper, '复制密钥').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(token)
    expect(wrapper.get('[role="status"]').text()).toBe('复制失败，请手动选择密钥并保存。')
    expect(disabled(wrapper, '完成')).toBe(true)

    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(disabled(wrapper, '完成')).toBe(false)
    await button(wrapper, '完成').trigger('click')
    expect(store.dismissSecret).toHaveBeenCalledTimes(1)
    expect(store.secret.value).toBeUndefined()
    expect(wrapper.findComponent(CliKeySecretModal).exists()).toBe(false)
    expect(wrapper.find('#cli-key-secret').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(token)
    expect(store.keys.value[0]).not.toHaveProperty('token')

    await button(wrapper, '刷新').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(CliKeySecretModal).exists()).toBe(false)
    expect(wrapper.html()).not.toContain(token)
    expect(wrapper.text()).toContain('cli_public_prefix')
  })

  it('ignores modal close until acknowledged, then forwards close and removes the token', async () => {
    const store = mockStore()
    store.secret.value = { key: key(), token: 'close-event-secret' }
    const { wrapper } = renderKeys(store)

    await button(wrapper, '关闭弹窗').trigger('click')
    expect(store.dismissSecret).not.toHaveBeenCalled()
    expect(store.secret.value?.token).toBe('close-event-secret')
    expect(wrapper.findComponent(CliKeySecretModal).exists()).toBe(true)

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await button(wrapper, '关闭弹窗').trigger('click')

    expect(store.dismissSecret).toHaveBeenCalledTimes(1)
    expect(store.secret.value).toBeUndefined()
    expect(wrapper.findComponent(CliKeySecretModal).exists()).toBe(false)
    expect(wrapper.html()).not.toContain('close-event-secret')
  })
})

describe('CommandBlock clipboard feedback', () => {
  it('reports copy failure and clears feedback when the command changes', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mount(CommandBlock, { props: { command: 'halo auth login --token-stdin' } })
    wrappers.push(wrapper)

    await button(wrapper, '复制命令').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('halo auth login --token-stdin')
    expect(wrapper.get('[role="status"]').text()).toBe('复制失败，请手动选择命令复制。')
    await wrapper.setProps({ command: 'halo auth status' })
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(wrapper.get('code').text()).toBe('halo auth status')
  })
})
