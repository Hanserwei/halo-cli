<script setup lang="ts">
import { VAlert, VButton, VModal, VSpace } from '@halo-dev/components'
import { ref } from 'vue'

const props = defineProps<{ token: string; displayName: string }>()
const emit = defineEmits<{ close: [] }>()
const acknowledged = ref(false)
const copying = ref(false)
const feedback = ref('')

async function copySecret() {
  copying.value = true
  feedback.value = ''
  try {
    await navigator.clipboard.writeText(props.token)
    feedback.value = '已复制，请保存到密码管理器。'
  } catch {
    feedback.value = '复制失败，请手动选择密钥并保存。'
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <VModal
    title="保存 CLI 密钥"
    :width="640"
    :layer-closable="false"
    mount-to-body
    @keyup.esc.capture.stop="acknowledged && emit('close')"
    @close="acknowledged && emit('close')"
  >
    <template #header>
      <div class=":uno: flex w-full items-center justify-between gap-3">
        <h2 class=":uno: text-base font-bold text-gray-900">保存 CLI 密钥</h2>
        <VButton size="sm" :disabled="!acknowledged" @click="emit('close')">关闭</VButton>
      </div>
    </template>
    <div class=":uno: space-y-4">
      <VAlert
        type="warning"
        title="完整密钥仅展示这一次"
        description="关闭弹窗后无法再次查看。若遗失，请轮换密钥；轮换后旧密钥立即失效。"
      />
      <label for="cli-key-secret" class=":uno: block text-sm font-medium text-gray-900">{{ displayName }}</label>
      <textarea
        id="cli-key-secret"
        :value="token"
        readonly
        autocomplete="off"
        autocapitalize="off"
        :spellcheck="false"
        rows="3"
        class=":uno: w-full rounded-base border border-gray-200 p-3 font-mono text-sm text-gray-900"
        aria-label="完整 CLI 密钥，仅展示一次"
      />
      <p class=":uno: text-sm text-gray-600">请保存在密码管理器中，并通过连接指南的标准输入传给 CLI。</p>
      <p role="status" class=":uno: text-sm text-gray-600">{{ feedback }}</p>
      <label class=":uno: flex items-center gap-2 text-sm text-gray-900">
        <input v-model="acknowledged" type="checkbox" />
        我已安全保存密钥
      </label>
    </div>
    <template #footer>
      <VSpace>
        <VButton :loading="copying" @click="copySecret">复制密钥</VButton>
        <VButton type="secondary" :disabled="!acknowledged" @click="emit('close')">完成</VButton>
      </VSpace>
    </template>
  </VModal>
</template>
