<script setup lang="ts">
import { VAlert, VCard } from '@halo-dev/components'
import CommandBlock from './CommandBlock.vue'

const repositoryUrl = 'https://github.com/hanserwei/halo-cli'

const commandGroups = [
  {
    id: 'auth',
    title: '连接与帮助',
    description: '查看已保存的 Profile 和当前连接，通过帮助确认各命令的参数。',
    command: `halo-cli auth current
halo-cli auth list
halo-cli --help
halo-cli post --help`,
    note: '使用 --profile <profile-name> 指定连接。auth use 会切换本地默认连接，执行写操作前请确认目标站点。',
  },
  {
    id: 'content',
    title: '文章、页面与分类标签',
    description: '查询内容与组织结构；get 可查看指定资源，list 可获取其真实名称。',
    command: `halo-cli post list
halo-cli post get <post-name>
halo-cli page list
halo-cli category list
halo-cli tag list`,
    note: '内容可能包含未发布草稿或私有资料。导出和分享输出前，请确认其可见范围。',
  },
  {
    id: 'comments',
    title: '评论与回复',
    description: '查看待审核评论和指定评论的回复。',
    command: `halo-cli comment list --approved false
halo-cli comment replies <comment-name>
halo-cli comment --help`,
    note: '审核、回复与删除会改变站点内容，需另行授予对应的写入或删除权限。',
  },
  {
    id: 'attachments',
    title: '附件与存储',
    description: '查询附件、存储策略和分组，上传前先确认目标策略。',
    command: `halo-cli attachment list
halo-cli attachment policies
halo-cli attachment groups
halo-cli attachment upload --help
halo-cli attachment download --help`,
    note: '上传和 URL 转存会写入存储，下载会写入本地文件；删除附件可能使文章中的图片或链接失效。',
  },
  {
    id: 'menus',
    title: '菜单与导航',
    description: '查看菜单列表、主菜单和树形结构。',
    command: `halo-cli menu list
halo-cli menu primary
halo-cli menu tree primary`,
    note: '设置主菜单、移动菜单项会影响前台导航。删除菜单或菜单项涉及级联行为，操作前请查看对应帮助。',
  },
  {
    id: 'plugins-themes',
    title: '插件、主题与配置',
    description: '查看插件、当前主题及配置。将占位符替换为 list 或 current 返回的资源名称。',
    command: `halo-cli plugin list
halo-cli plugin config <plugin-name>
halo-cli theme list
halo-cli theme current
halo-cli theme config <theme-name>`,
    note: '配置读取默认脱敏。启停插件、切换主题、导入或重置配置会影响运行中的站点；原始敏感配置只能导出到文件，请限制文件访问。',
  },
  {
    id: 'extensions',
    title: 'Extension 与 Hao 适配',
    description: '发现预设资源，读取插件数据并检查 Hao 主题适配状态；需要站点安装相应插件或主题。',
    command: `halo-cli extension presets
halo-cli extension list moment
halo-cli hao doctor`,
    note: '通用 Extension 的更新、补丁和删除直接影响插件数据。请先读取资源，确认模型、名称及相关插件的约束。',
  },
  {
    id: 'search-api',
    title: '搜索与同站 API',
    description: '搜索内容，或读取当前站点的 JSON API。自定义 API 的可用性取决于站点和密钥权限。',
    command: `halo-cli search query "Halo"
halo-cli api request GET /apis/api.console.halo.run/v1alpha1/posts
halo-cli api --help`,
    note: 'API 请求仍受密钥作用域与所属用户权限限制。POST、PUT、PATCH、DELETE 等请求可能写入或删除数据，发送前请确认接口语义。',
  },
  {
    id: 'settings-hanlo',
    title: '站点设置与 Hanlo 配置',
    description: '从实际 Schema 发现配置字段，使用 dry-run 预览嵌套字段修改。',
    command: `halo-cli settings list --json
halo-cli settings schema basic --fields --json
halo-cli hanlo config-fields --json
halo-cli hanlo config-set /equipment/bigTitle "我的装备" --dry-run --json`,
    note: '局部修改保留其他字段，导入默认合并。配置和差异默认脱敏，完整替换与重置需要明确确认。',
  },
  {
    id: 'plugin-content',
    title: '装备、瞬间、图库与友链',
    description: '使用独立装备模型和插件业务接口管理内容；插件设置通过 config-fields 发现。',
    command: `halo-cli equipment schema --json
halo-cli moment list --json
halo-cli photo groups --json
halo-cli link application-list --json
halo-cli plugin config-fields PluginPhotos --json`,
    note: '图库上传使用插件配置的存储策略；它的分组与附件分组不同。审核和级联删除需先核对目标。',
  },
  {
    id: 'object-storage',
    title: 'S3 与对象存储',
    description: '通过 Halo 存储策略管理对象存储，上传时只指定策略和文件。',
    command: `halo-cli storage templates --json
halo-cli storage list --json
halo-cli storage config-fields <policy-name> --json
halo-cli attachment upload --file ./image.png --policy <policy-name> --dry-run --json`,
    note: '凭据由 Halo 服务端读取。首次配置可通过私有 JSON 文件导入，CLI 输出默认脱敏。',
  },
]

const publishCommands = `halo-cli post create --title "示例草稿" --file ./post.md
halo-cli post publish <post-name>`

const automationCommands = `halo-cli post list --profile <profile-name> --json
halo-cli plugin list --profile <profile-name> --json`
</script>

<template>
  <VCard title="常用命令">
    <div class=":uno: space-y-6 text-sm">
      <p class=":uno: text-gray-600">
        下方查询示例以只读操作为主，各组均需对应的读取作用域。
        &lt;post-name&gt; 等尖括号内容是占位符，执行前请替换整个占位符；
        资源名称指 metadata.name，可通过 list 查询，并非标题或显示名称。
      </p>

      <VAlert title="执行前确认权限与目标" type="warning" :closable="false">
        <template #description>
          先运行 auth current 确认连接，自动化中建议显式指定 --profile。
          写入、发布、删除和配置变更需单独授权；密钥权限还受所属用户权限约束。
          删除、回收、重置等操作可能要求 --yes，这代表明确确认，不能代替检查目标和备份。
          请勿为整批命令盲目追加 --yes。
        </template>
      </VAlert>

      <section
        v-for="group in commandGroups"
        :key="group.id"
        class=":uno: space-y-3"
        :aria-labelledby="`cli-command-${group.id}`"
      >
        <h3 :id="`cli-command-${group.id}`" class=":uno: font-medium">{{ group.title }}</h3>
        <p class=":uno: text-gray-600">{{ group.description }}</p>
        <CommandBlock :label="group.title" :command="group.command" />
        <p class=":uno: text-gray-600">{{ group.note }}</p>
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-command-publish">
        <h3 id="cli-command-publish" class=":uno: font-medium">创建与发布 · 会修改站点</h3>
        <p class=":uno: text-gray-600">
          第一条命令将本地 post.md 创建为草稿；确认创建结果并取得文章名称后，再单独执行第二条发布命令。
          发布会使内容按文章的可见性设置对外展示，请先检查正文、附件与可见范围。
        </p>
        <CommandBlock label="写入示例 · 请逐条确认后执行" :command="publishCommands" />
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-command-automation">
        <h3 id="cli-command-automation" class=":uno: font-medium">自动化与结构化输出</h3>
        <p class=":uno: text-gray-600">
          查询及写操作支持 --json，便于脚本解析。示例中的 Profile 名称需替换为已有连接。
          自动化使用专用密钥，并仅授予所需作用域；不要将凭据硬编码到脚本或日志。
        </p>
        <CommandBlock label="指定连接并输出 JSON" :command="automationCommands" />
      </section>

      <div class=":uno: flex flex-wrap gap-4 border-t border-gray-100 pt-4">
        <a
          :href="`${repositoryUrl}/blob/main/README.md#命令参考`"
          target="_blank"
          rel="noopener noreferrer"
          class=":uno: text-primary hover:underline"
        >
          完整命令参考（仓库 README）
        </a>
        <a
          :href="`${repositoryUrl}/blob/main/cli/README.md`"
          target="_blank"
          rel="noopener noreferrer"
          class=":uno: text-primary hover:underline"
        >
          CLI README
        </a>
      </div>
    </div>
  </VCard>
</template>
