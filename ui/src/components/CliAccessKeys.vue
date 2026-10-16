<script setup lang="ts">
import {
  Toast, VAlert, VButton, VCard, VEmpty, VEntity, VEntityContainer,
  VEntityField, VLoading, VModal, VSpace, VStatusDot,
} from '@halo-dev/components'
import { utils } from '@halo-dev/ui-shared'
import { computed, onMounted, ref } from 'vue'
import type { AccessKey, CreateAccessKeyRequest, UpdateAccessKeyRequest } from '../api/types'
import { useAccessKeys } from '../composables/use-access-keys'
import CliKeyFormModal from './CliKeyFormModal.vue'
import CliKeySecretModal from './CliKeySecretModal.vue'

const {
  keys, scopes, loading, scopesReady, listError, scopeError, mutationError,
  busy, secret, load, create, update, disable, rotate, remove, dismissSecret,
} = useAccessKeys()
const canManage = computed(() => utils.permission.getUserPermissions() !== undefined
  && utils.permission.has(['plugin:halo-cli:keys:manage']))
const formOpen = ref(false)
const editingKey = ref<AccessKey>()
const confirmation = ref<{ action: 'rotate' | 'delete' | 'disable'; key: AccessKey }>()
const confirmedName = ref('')
const operationsDisabled = computed(() => Boolean(busy.value) || loading.value || Boolean(secret.value))
const formDisabled = computed(() => operationsDisabled.value || !scopesReady.value || !scopes.value.length)

onMounted(() => { void load() })

function openForm(key?: AccessKey) {
  if (!canManage.value || formDisabled.value) return
  editingKey.value = key
  mutationError.value = ''
  formOpen.value = true
}

function requestConfirmation(action: 'rotate' | 'delete' | 'disable', key: AccessKey) {
  if (!canManage.value || operationsDisabled.value) return
  if (action === 'rotate' && (!key.enabled || Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()))) return
  confirmation.value = { action, key }
  confirmedName.value = ''
  mutationError.value = ''
}

async function save(request: CreateAccessKeyRequest | UpdateAccessKeyRequest) {
  if (!canManage.value || formDisabled.value) return
  const saved = editingKey.value
    ? await update(editingKey.value.name, { ...request, enabled: 'enabled' in request ? request.enabled : editingKey.value.enabled })
    : await create(request)
  if (saved) {
    formOpen.value = false
    editingKey.value = undefined
    if (!secret.value) Toast.success('密钥已更新')
  }
}

async function confirmOperation() {
  const pending = confirmation.value
  if (!canManage.value || operationsDisabled.value || !pending || confirmedName.value !== pending.key.displayName) return
  const current = keys.value.find((key) => key.name === pending.key.name)
  if (!current || current.displayName !== confirmedName.value) return
  if (pending.action === 'rotate' && (!current.enabled || Boolean(current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()))) return
  const succeeded = pending.action === 'rotate'
    ? await rotate(pending.key.name)
    : pending.action === 'disable' ? await disable(pending.key.name) : await remove(pending.key.name)
  if (succeeded) {
    confirmation.value = undefined
    confirmedName.value = ''
    if (pending.action === 'delete') Toast.success('密钥已删除')
    if (pending.action === 'disable') Toast.success('密钥已禁用')
  }
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '无效时间'
}
</script>

<template>
  <section id="cli-access-keys" aria-label="CLI 密钥管理">
    <VCard title="CLI 密钥" :body-class="[':uno: !p-0']">
      <template #actions>
        <VSpace>
          <VButton size="sm" :disabled="operationsDisabled" @click="load">刷新</VButton>
          <VButton v-if="canManage" type="secondary" size="sm" :disabled="formDisabled" @click="openForm()">
            创建密钥
          </VButton>
        </VSpace>
      </template>
      <div class=":uno: space-y-3 border-b border-gray-100 p-4">
        <p class=":uno: text-sm text-gray-600">为每台设备或自动化任务创建独立密钥，按需授予权限、限制来源并设置过期时间。</p>
        <p v-if="!canManage" class=":uno: text-sm text-gray-500">当前仅可查看密钥，管理操作需要管理员授予权限。</p>
        <VAlert v-if="scopeError" type="warning" title="权限范围不可用" :description="scopeError" role="alert">
          <template #actions><VButton size="sm" :disabled="operationsDisabled" @click="load">重试</VButton></template>
        </VAlert>
        <VAlert
          v-else-if="scopesReady && !scopes.length"
          type="warning"
          title="暂无可授予的权限范围"
          description="创建和编辑已禁用，请检查插件配置后刷新。"
        />
        <VAlert
          v-if="mutationError && !formOpen && !confirmation"
          type="error"
          title="操作失败"
          :description="mutationError"
          role="alert"
        />
      </div>
      <VLoading v-if="loading" />
      <VEmpty v-else-if="listError" title="无法加载密钥" :message="listError" role="alert">
        <template #actions><VButton @click="load">重试</VButton></template>
      </VEmpty>
      <VEmpty v-else-if="!keys.length" title="尚未创建 CLI 密钥" message="创建密钥后即可按连接指南登录当前站点。">
        <template #actions>
          <VButton v-if="canManage" type="secondary" :disabled="formDisabled" @click="openForm()">创建密钥</VButton>
        </template>
      </VEmpty>
      <VEntityContainer v-else>
        <VEntity v-for="key in keys" :key="key.name">
          <template #start>
            <VEntityField :title="key.displayName" :description="`${key.keyPrefix}… · 所有者 ${key.ownerName}`">
              <template #extra>
                <VStatusDot
                  :state="!key.enabled ? 'warning' : key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now() ? 'warning' : 'success'"
                  :text="!key.enabled ? '已禁用' : key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now() ? '已过期' : '已启用'"
                />
              </template>
            </VEntityField>
          </template>
          <template v-if="canManage" #end>
            <VSpace>
              <VButton size="sm" :disabled="formDisabled" @click="openForm(key)">编辑</VButton>
              <VButton v-if="key.enabled" size="sm" :disabled="operationsDisabled" @click="requestConfirmation('disable', key)">禁用</VButton>
              <VButton
                size="sm"
                :disabled="operationsDisabled || !key.enabled || Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now())"
                @click="requestConfirmation('rotate', key)"
              >轮换</VButton>
              <VButton type="danger" size="sm" :disabled="operationsDisabled" @click="requestConfirmation('delete', key)">删除</VButton>
            </VSpace>
          </template>
          <template #footer>
            <dl class=":uno: grid gap-2 px-4 pb-4 text-xs text-gray-500 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt class=":uno: font-medium">权限范围</dt><dd class=":uno: break-words">{{ key.scopes.map((name) => scopes.find((scope) => scope.name === name)?.displayName || name).join('、') || '无' }}</dd></div>
              <div><dt class=":uno: font-medium">允许的直接连接地址</dt><dd class=":uno: break-words">{{ key.allowedIpRanges.join('、') || '所有来源' }}</dd></div>
              <div><dt class=":uno: font-medium">过期时间</dt><dd>{{ key.expiresAt ? formatTime(key.expiresAt) : '永不过期' }}</dd></div>
              <div><dt class=":uno: font-medium">创建时间</dt><dd>{{ formatTime(key.createdAt) }}</dd></div>
              <div><dt class=":uno: font-medium">最近使用</dt><dd>{{ key.lastUsedAt ? formatTime(key.lastUsedAt) : '尚未使用' }}</dd></div>
            </dl>
          </template>
        </VEntity>
      </VEntityContainer>
    </VCard>
    <CliKeyFormModal
      v-if="formOpen"
      :access-key="editingKey"
      :scopes="scopes"
      :busy="Boolean(busy)"
      :error="mutationError"
      @save="save"
      @close="formOpen = false"
    />
    <VModal
      v-if="confirmation"
      :title="confirmation.action === 'rotate' ? '轮换 CLI 密钥' : confirmation.action === 'disable' ? '禁用 CLI 密钥' : '删除 CLI 密钥'"
      :width="520"
      :layer-closable="!busy"
      mount-to-body
      @close="confirmation = undefined"
    >
      <div class=":uno: space-y-4">
        <VAlert
          type="warning"
          :title="confirmation.action === 'rotate' ? '旧密钥将立即失效' : confirmation.action === 'disable' ? '密钥将立即停用' : '删除后无法恢复'"
          :description="confirmation.action === 'rotate' ? '使用旧密钥的设备和自动化任务需要更新凭据。新密钥仅展示一次。' : '使用此密钥的设备和自动化任务将无法继续连接。'"
        />
        <VAlert v-if="mutationError" type="error" title="操作失败" :description="mutationError" role="alert" />
        <FormKit
          v-model="confirmedName"
          type="text"
          name="confirmName"
          :label="`输入密钥名称「${confirmation.key.displayName}」确认`"
          autocomplete="off"
          :disabled="Boolean(busy)"
        />
      </div>
      <template #footer>
        <VSpace>
          <VButton :disabled="Boolean(busy)" @click="confirmation = undefined">取消</VButton>
          <VButton
            type="danger"
            :loading="Boolean(busy)"
            :disabled="!canManage || operationsDisabled || confirmedName !== confirmation.key.displayName"
            @click="confirmOperation"
          >{{ confirmation.action === 'rotate' ? '确认轮换' : confirmation.action === 'disable' ? '确认禁用' : '确认删除' }}</VButton>
        </VSpace>
      </template>
    </VModal>
    <CliKeySecretModal
      v-if="secret"
      :token="secret.token"
      :display-name="secret.key.displayName"
      @close="dismissSecret"
    />
  </section>
</template>
