import { VModal } from '@halo-dev/components'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CliKeyFormModal from '../CliKeyFormModal.vue'
import CliKeySecretModal from '../CliKeySecretModal.vue'

// Keep VModal and Vue's Transition real: a slot-only modal stub cannot detect
// the initial hidden state of Halo 2.26's non-immediate visible watcher.
const global = {
  stubs: {
    transition: false,
    FormKit: true,
    VAlert: true,
    VButton: true,
  },
}
const wrappers: VueWrapper[] = []

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('CLI modal first opening with the real Halo VModal', () => {
  it('opens the create form on its first conditional mount', async () => {
    const Host = defineComponent({
      components: { CliKeyFormModal },
      setup() {
        return { open: ref(false) }
      },
      template: `<button @click="open = true">创建密钥</button>
        <CliKeyFormModal v-if="open" :scopes="[]" :busy="false" error="" @close="open = false" />`,
    })
    const wrapper = mount(Host, { attachTo: document.body, global })
    wrappers.push(wrapper)
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await wrapper.get('button').trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(VModal).exists()).toBe(true)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(new DOMWrapper(dialog!).isVisible()).toBe(true)
    const form = document.querySelector<HTMLFormElement>('#cli-key-form')
    expect(form).not.toBeNull()
    expect(new DOMWrapper(form!).isVisible()).toBe(true)
    expect(dialog?.textContent).toContain('创建 CLI 密钥')
  })

  it('makes the one-time secret visible immediately when the secret modal mounts', async () => {
    const token = 'hcli_test_first_open_secret'
    const Host = defineComponent({
      components: { CliKeySecretModal },
      setup() {
        return { open: ref(false), token }
      },
      template: `<button @click="open = true">显示新密钥</button>
        <CliKeySecretModal v-if="open" :token="token" display-name="部署任务" @close="open = false" />`,
    })
    const wrapper = mount(Host, { attachTo: document.body, global })
    wrappers.push(wrapper)
    expect(document.querySelector('#cli-key-secret')).toBeNull()

    await wrapper.get('button').trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(VModal).exists()).toBe(true)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const secret = document.querySelector<HTMLTextAreaElement>('#cli-key-secret')
    expect(dialog).not.toBeNull()
    expect(secret).not.toBeNull()
    expect(new DOMWrapper(dialog!).isVisible()).toBe(true)
    expect(new DOMWrapper(secret!).isVisible()).toBe(true)
    expect(secret?.value).toBe(token)
    expect(dialog?.textContent).toContain('保存 CLI 密钥')
  })
})
