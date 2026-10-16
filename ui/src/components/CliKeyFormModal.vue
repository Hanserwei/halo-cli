<script setup lang="ts">
import { VAlert, VButton, VModal, VSpace } from '@halo-dev/components'
import { computed, ref } from 'vue'
import type { AccessKey, CreateAccessKeyRequest, Scope, UpdateAccessKeyRequest } from '../api/types'

const props = defineProps<{
  accessKey?: AccessKey
  scopes: Scope[]
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  close: []
  save: [request: CreateAccessKeyRequest | UpdateAccessKeyRequest]
}>()

const displayName = ref(props.accessKey?.displayName ?? '')
const selectedScopes = ref([...(props.accessKey?.scopes ?? [])])
const allowedIpRanges = ref(props.accessKey?.allowedIpRanges.join('\n') ?? '')
const enabled = ref(props.accessKey?.enabled ?? true)
const initialExpiry = props.accessKey?.expiresAt
const initialDate = initialExpiry ? new Date(initialExpiry) : undefined
const initialLocalExpiry = initialDate && Number.isFinite(initialDate.getTime())
  ? new Date(initialDate.getTime() - initialDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  : ''
const expiresAt = ref(initialLocalExpiry)
const unknownScopes = computed(() => selectedScopes.value.filter(
  (name) => !props.scopes.some((scope) => scope.name === name),
))
const invalidExpiry = computed(() => expiresAt.value !== initialLocalExpiry && expiresAt.value !== '' && (
  !Number.isFinite(new Date(expiresAt.value).getTime()) || new Date(expiresAt.value).getTime() <= Date.now()
))
const canSubmit = computed(() => !props.busy && displayName.value.trim().length > 0
  && displayName.value.trim().length <= 100 && selectedScopes.value.length > 0
  && unknownScopes.value.length === 0 && !invalidExpiry.value)

function submit() {
  if (!canSubmit.value) return
  const request: CreateAccessKeyRequest = {
    displayName: displayName.value.trim(),
    scopes: [...selectedScopes.value],
    allowedIpRanges: [...new Set(allowedIpRanges.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))],
    expiresAt: expiresAt.value === initialLocalExpiry && initialDate && Number.isFinite(initialDate.getTime())
      ? initialDate.toISOString()
      : expiresAt.value ? new Date(expiresAt.value).toISOString() : null,
  }
  emit('save', props.accessKey ? { ...request, enabled: enabled.value } : request)
}
</script>

<template>
  <VModal
    :title="accessKey ? '编辑 CLI 密钥' : '创建 CLI 密钥'"
    :width="640"
    :layer-closable="!busy"
    mount-to-body
    @close="!busy && emit('close')"
  >
    <form id="cli-key-form" class=":uno: space-y-4" @submit.prevent="submit">
      <VAlert v-if="error" type="error" title="保存失败" :description="error" role="alert" />
      <FormKit
        v-model="displayName"
        type="text"
        name="displayName"
        label="名称"
        help="用于区分设备或自动化任务，最多 100 个字符。"
        validation="required|length:1,100"
        :disabled="busy"
      />
      <fieldset :disabled="busy" class=":uno: space-y-2">
        <legend class=":uno: text-sm font-medium text-gray-900">权限范围</legend>
        <p class=":uno: text-xs text-gray-500">至少选择一项，仅授予此任务需要的权限。</p>
        <label
          v-for="scope in scopes"
          :key="scope.name"
          class=":uno: flex items-start gap-2 rounded-base border border-gray-200 p-3"
        >
          <input v-model="selectedScopes" type="checkbox" :value="scope.name" class=":uno: mt-1" />
          <span>
            <span class=":uno: block text-sm font-medium text-gray-900">{{ scope.displayName }}</span>
            <span class=":uno: block text-xs text-gray-500">{{ scope.description }}</span>
            <code class=":uno: text-xs text-gray-500">{{ scope.name }}</code>
          </span>
        </label>
        <p v-if="!scopes.length" role="status" class=":uno: text-sm text-gray-600">
          当前没有可授予的权限，暂时无法保存密钥。
        </p>
        <template v-if="unknownScopes.length">
          <VAlert type="warning" title="部分权限已不可用，请移除后保存。" />
          <label v-for="name in unknownScopes" :key="name" class=":uno: flex items-center gap-2 text-sm">
            <input v-model="selectedScopes" type="checkbox" :value="name" />
            {{ name }}（不可用）
          </label>
        </template>
      </fieldset>
      <FormKit
        v-model="allowedIpRanges"
        type="textarea"
        name="allowedIpRanges"
        label="允许的直接连接 IP / CIDR"
        help="每行一项，例如 192.0.2.10 或 2001:db8::/32。匹配 Halo 的直接连接地址；经过反向代理时是代理地址。留空不限制来源。"
        :disabled="busy"
      />
      <FormKit
        v-model="expiresAt"
        type="datetime-local"
        name="expiresAt"
        label="过期时间（本地时区）"
        help="留空表示永不过期。建议为自动化任务设置有效期。"
        :disabled="busy"
      />
      <p v-if="invalidExpiry" role="alert" class=":uno: text-sm text-red-600">请选择未来时间或清空过期时间。</p>
      <FormKit
        v-if="accessKey"
        v-model="enabled"
        type="checkbox"
        name="enabled"
        label="启用密钥"
        help="禁用后使用此密钥的 CLI 和自动化任务将无法连接。"
        :disabled="busy"
      />
      <p v-else class=":uno: text-xs text-gray-500">创建后仅展示一次完整密钥，请立即保存。</p>
    </form>
    <template #footer>
      <VSpace>
        <VButton :disabled="busy" @click="emit('close')">取消</VButton>
        <VButton type="secondary" :disabled="!canSubmit" :loading="busy" @click="submit">
          {{ accessKey ? '保存' : '创建' }}
        </VButton>
      </VSpace>
    </template>
  </VModal>
</template>
