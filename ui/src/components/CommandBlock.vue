<script setup lang="ts">
import { VButton } from '@halo-dev/components'
import { ref, watch } from 'vue'

const props = defineProps<{ command: string; label?: string }>()
const feedback = ref('')
const copying = ref(false)
watch(() => props.command, () => { feedback.value = '' })

async function copyCommand() {
  copying.value = true
  feedback.value = ''
  try {
    await navigator.clipboard.writeText(props.command)
    feedback.value = '已复制'
  } catch {
    feedback.value = '复制失败，请手动选择命令复制。'
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class=":uno: overflow-hidden rounded-base border border-gray-200">
    <div class=":uno: flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-3 py-2">
      <span class=":uno: text-xs text-gray-600">{{ label || '命令' }}</span>
      <div class=":uno: flex items-center gap-2">
        <span role="status" class=":uno: text-xs text-gray-600">{{ feedback }}</span>
        <VButton size="xs" :loading="copying" @click="copyCommand">复制命令</VButton>
      </div>
    </div>
    <pre class=":uno: overflow-x-auto p-3 text-xs leading-6 text-gray-800"><code>{{ command }}</code></pre>
  </div>
</template>
