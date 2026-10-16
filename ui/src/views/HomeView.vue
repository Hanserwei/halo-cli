<script setup lang="ts">
import { IconPlug, VPageHeader } from '@halo-dev/components'
import CliAccessKeys from '../components/CliAccessKeys.vue'
import CliCommandGuide from '../components/CliCommandGuide.vue'
import CliSetupGuide from '../components/CliSetupGuide.vue'
</script>

<template>
  <VPageHeader title="Halo CLI">
    <template #icon><IconPlug /></template>
    <template #actions>
      <a
        href="https://github.com/hanserwei/halo-cli"
        target="_blank"
        rel="noopener noreferrer"
        class=":uno: text-sm text-gray-600 hover:text-gray-900"
      >使用文档</a>
    </template>
  </VPageHeader>
  <div class=":uno: space-y-4 p-4">
    <p class=":uno: text-sm text-gray-600">下载 CLI，为设备或自动化任务配置访问密钥，然后连接当前 Halo 站点。</p>
    <HasPermission :permissions="['plugin:halo-cli:keys:view']">
      <CliAccessKeys />
    </HasPermission>
    <CliSetupGuide />
    <CliCommandGuide />
  </div>
</template>
