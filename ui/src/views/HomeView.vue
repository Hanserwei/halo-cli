<script setup lang="ts">
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  ConfigProvider,
  Descriptions,
  DescriptionsItem,
  Divider,
  Flex,
  Row,
  Space,
  Statistic,
  Steps,
  Tabs,
  Tag,
  TypographyParagraph,
  TypographyText,
  TypographyTitle,
} from 'antdv-next'
import { computed, markRaw, ref } from 'vue'
import IconArrowRightLine from '~icons/ri/arrow-right-line'
import IconArticleLine from '~icons/ri/article-line'
import IconChat3Line from '~icons/ri/chat-3-line'
import IconCheckLine from '~icons/ri/check-line'
import IconCodeBoxLine from '~icons/ri/code-box-line'
import IconDownloadCloud2Line from '~icons/ri/download-cloud-2-line'
import IconExternalLinkLine from '~icons/ri/external-link-line'
import IconFolderSettingsLine from '~icons/ri/folder-settings-line'
import IconGithubLine from '~icons/ri/github-line'
import IconLayoutGridLine from '~icons/ri/layout-grid-line'
import IconPlugLine from '~icons/ri/plug-line'
import IconTerminalBoxLine from '~icons/ri/terminal-box-line'

const downloadPath = '/apis/console.api.halo-cli.halo.run/v1alpha1/downloads/cli'
const repositoryUrl = 'https://github.com/hanserwei/halo-cli'
const currentVersion = '0.5.0'
const origin = window.location.origin
const siteHost = window.location.host

const themeConfig = {
  token: {
    colorPrimary: '#425aef',
    colorInfo: '#425aef',
    colorSuccess: '#3d7c0f',
    borderRadius: 8,
    borderRadiusLG: 12,
    colorText: '#171c25',
    colorTextSecondary: '#667085',
    colorBorder: '#d8dce3',
    colorBgLayout: '#f3f3ef',
    colorBgContainer: '#fffefb',
    fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: {
      fontWeight: 600,
      primaryShadow: 'none',
    },
  },
}

const heroStatisticStyles = {
  title: {
    color: '#737b8c',
    fontSize: '11px',
    fontFamily: '"SFMono-Regular", Consolas, monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  content: {
    color: '#171c25',
    fontSize: '21px',
    fontWeight: 600,
  },
}

interface SetupDetail {
  key: string
  tab: string
  title: string
  description: string
  command: string
  notes: string[]
  action?: 'download'
}

const activeSetup = ref('install')

const setupDetails = computed<SetupDetail[]>(() => [
  {
    key: 'install',
    tab: '1. 安装',
    title: '安装到本地命令目录',
    description: '先下载单文件 CLI，再把它放入 PATH。以下命令适用于 Linux 和 macOS。',
    command:
      'mkdir -p ~/.local/bin\ninstall -m 0755 ~/Downloads/halo-cli.cjs ~/.local/bin/halo-cli\nhalo-cli --version',
    notes: ['下载文件名固定为 halo-cli.cjs', '请确认 ~/.local/bin 已加入 PATH'],
    action: 'download',
  },
  {
    key: 'connect',
    tab: '2. 连接',
    title: '安全连接当前 Halo 站点',
    description: '在个人中心创建个人令牌。通过隐藏输入读取令牌，避免把凭据写进 Shell 历史。',
    command: `read -rsp "Halo PAT: " HALO_PAT_INPUT
echo
halo-cli auth login \\
  --profile default \\
  --url ${origin} \\
  --token "\${HALO_PAT_INPUT}"
unset HALO_PAT_INPUT`,
    notes: ['令牌仅保存在权限为 0600 的本地配置文件', '可以创建多个 Profile 管理不同站点'],
  },
  {
    key: 'verify',
    tab: '3. 验证',
    title: '验证连接并开始管理',
    description: '先确认当前连接，再运行只读命令检查文章、插件与主题资源。',
    command:
      'halo-cli auth current\nhalo-cli post list\nhalo-cli plugin list\nhalo-cli theme current',
    notes: ['查询命令均支持 --json', '使用 halo-cli --help 查看全部命令'],
  },
])

const setupStepItems = computed(() =>
  setupDetails.value.map((item) => ({
    title: item.tab,
    content: item.title,
  })),
)

const setupTabItems = computed(() =>
  setupDetails.value.map((item) => ({
    key: item.key,
    label: item.tab,
  })),
)

const activeSetupIndex = computed(() => {
  const index = setupDetails.value.findIndex((item) => item.key === activeSetup.value)
  return index >= 0 ? index : 0
})

const activeSetupDetail = computed(
  () => setupDetails.value[activeSetupIndex.value] ?? setupDetails.value[0]!,
)

function selectSetupStep(index: number) {
  const detail = setupDetails.value[index]
  if (detail) activeSetup.value = detail.key
}

const commandGroups = [
  {
    key: 'content',
    label: '内容创作与发布',
    content: `halo-cli post list
halo-cli post create --title "Hello" --file post.md --publish
halo-cli page list
halo-cli category list
halo-cli tag list`,
  },
  {
    key: 'interaction',
    label: '评论与附件',
    content: `halo-cli comment list --approved false
halo-cli comment replies <comment-name>
halo-cli attachment policies
halo-cli attachment groups
halo-cli attachment upload --file ./cover.png --policy <policy-name>`,
  },
  {
    key: 'site',
    label: '导航、插件与主题',
    content: `halo-cli menu tree primary
halo-cli plugin list
halo-cli plugin config <plugin-name>
halo-cli theme current
halo-cli theme config <theme-name>`,
  },
  {
    key: 'extension',
    label: 'Extension、Hao 与自动化',
    content: `halo-cli hao doctor
halo-cli extension presets
halo-cli extension list moment
halo-cli search query "Halo"
halo-cli api request GET /apis/api.plugin.halo.run/v1alpha1/plugins/plugin-afdian/afdian/getSponsorList`,
  },
]

const featureGroups = [
  {
    title: '内容发布',
    description: '文章和页面的创建、更新、发布、快照、回收与恢复。',
    commands: ['post', 'page'],
    icon: markRaw(IconArticleLine),
  },
  {
    title: '内容组织',
    description: '分类、标签和多级菜单树的查询、维护与排序。',
    commands: ['category', 'tag', 'menu'],
    icon: markRaw(IconLayoutGridLine),
  },
  {
    title: '互动与媒体',
    description: '评论审核与回复，以及附件上传、转存、下载和删除。',
    commands: ['comment', 'attachment'],
    icon: markRaw(IconChat3Line),
  },
  {
    title: '插件与主题',
    description: '生命周期、Setting Schema、配置导入导出与定点修改。',
    commands: ['plugin', 'theme'],
    icon: markRaw(IconPlugLine),
  },
  {
    title: 'Extension 与 Hao',
    description: '通用资源 CRUD，以及 Hao 主题依赖和常用插件模型适配。',
    commands: ['extension', 'hao'],
    icon: markRaw(IconFolderSettingsLine),
  },
  {
    title: '搜索与自定义 API',
    description: '搜索索引、同站 JSON API、multipart 上传和结构化输出。',
    commands: ['search', 'api'],
    icon: markRaw(IconCodeBoxLine),
  },
]
</script>

<template>
  <ConfigProvider :theme="themeConfig">
    <main class="cli-page">
      <Flex class="cli-page__content" vertical :gap="24">
        <Flex class="utility-bar" align="center" justify="space-between" gap="small" wrap>
          <Space :size="10">
            <span class="utility-bar__glyph" aria-hidden="true">$_</span>
            <span class="utility-bar__brand">
              <TypographyText strong>HALO / CLI</TypographyText>
              <TypographyText type="secondary">CONTENT OPERATIONS</TypographyText>
            </span>
          </Space>
          <Space :size="10" wrap>
            <span class="live-signal"><i aria-hidden="true" /> LOCAL-FIRST</span>
            <Tag variant="outlined">v{{ currentVersion }}</Tag>
          </Space>
        </Flex>

        <Card class="hero-card" variant="borderless" :styles="{ body: { padding: 0 } }">
          <span class="hero-card__watermark" aria-hidden="true">CLI</span>
          <div class="hero-card__registration hero-card__registration--top" aria-hidden="true" />
          <div class="hero-card__registration hero-card__registration--bottom" aria-hidden="true" />
          <Row class="hero-card__content" :gutter="[52, 36]" align="middle">
            <Col :xs="24" :lg="13">
              <Flex vertical :gap="20">
                <Space :size="8" wrap>
                  <Tag color="blue" variant="outlined">
                    <IconTerminalBoxLine /> Halo Operator Toolkit
                  </Tag>
                  <Tag variant="outlined">单文件分发</Tag>
                  <Tag color="green" variant="outlined">RBAC GATED</Tag>
                </Space>
                <TypographyTitle class="hero-card__title" :level="1">
                  把 Halo，<br />带进终端。
                </TypographyTitle>
                <TypographyParagraph class="hero-card__description">
                  一套本地优先、可脚本化的命令，管理内容、媒体、导航、主题、插件和
                  Extension。没有额外服务，也没有新的运维负担。
                </TypographyParagraph>
                <Space class="hero-actions" :size="12" wrap>
                  <Button :href="downloadPath" type="primary" size="large" download="halo-cli.cjs">
                    <template #icon><IconDownloadCloud2Line /></template>
                    下载 halo-cli.cjs
                  </Button>
                  <Button :href="repositoryUrl" target="_blank" rel="noreferrer" size="large">
                    <template #icon><IconGithubLine /></template>
                    查看源码
                  </Button>
                </Space>
                <Space class="hero-card__meta" :size="16" wrap>
                  <span>Node 20.19+</span>
                  <span>Linux / macOS / Windows</span>
                  <span>JSON READY</span>
                </Space>
              </Flex>
            </Col>
            <Col :xs="24" :lg="11">
              <Card class="terminal-card" variant="borderless" :styles="{ body: { padding: 0 } }">
                <Flex class="terminal-card__bar" align="center" justify="space-between">
                  <Space :size="6">
                    <i class="terminal-dot terminal-dot--red" />
                    <i class="terminal-dot terminal-dot--amber" />
                    <i class="terminal-dot terminal-dot--green" />
                  </Space>
                  <TypographyText>halo-cli — operator@{{ siteHost }}</TypographyText>
                </Flex>
                <pre
                  class="terminal-card__screen"
                ><code><span class="terminal-prompt">$</span> halo-cli auth current
<span class="terminal-key">PROFILE</span>  default
<span class="terminal-key">ENDPOINT</span> {{ origin }}
<span class="terminal-key">STATUS</span>   <span class="terminal-ok">● connected</span>

<span class="terminal-prompt">$</span> halo-cli post list --size 3
<span class="terminal-muted">NAME             STAGE       UPDATED</span>
welcome-to-halo  PUBLISHED   just now
release-notes    DRAFT       2m ago
<span class="terminal-cursor" aria-hidden="true">▋</span></code></pre>
                <Flex class="terminal-card__footer" justify="space-between" gap="small" wrap>
                  <span><i aria-hidden="true" /> CONNECTION VERIFIED</span>
                  <span>CTRL+C TO EXIT</span>
                </Flex>
              </Card>

              <Card class="hero-card__statistics" variant="borderless">
                <Row :gutter="[12, 18]">
                  <Col :span="8">
                    <Statistic
                      title="当前版本"
                      :value="`v${currentVersion}`"
                      :styles="heroStatisticStyles"
                    />
                  </Col>
                  <Col :span="8">
                    <Statistic title="命令域" :value="14" :styles="heroStatisticStyles" />
                  </Col>
                  <Col :span="8">
                    <Statistic title="自动化输出" value="JSON" :styles="heroStatisticStyles" />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>
        </Card>

        <Alert
          class="runtime-alert"
          type="info"
          show-icon
          title="Runtime note / 运行环境"
          description="需要 Node.js 20.19 或更高版本。下方安装命令适用于 Linux / macOS；Windows 可直接运行 node halo-cli.cjs。"
        />

        <Card class="section-card section-card--workflow" variant="borderless">
          <template #title>
            <Flex align="center" :gap="12">
              <Avatar class="section-avatar" shape="square" :size="42">
                <template #icon><IconTerminalBoxLine /></template>
              </Avatar>
              <Flex vertical :gap="2">
                <TypographyText strong>三步开始使用</TypographyText>
                <TypographyText type="secondary">
                  下载、连接、验证，凭据只保存在你的本地设备。
                </TypographyText>
              </Flex>
            </Flex>
          </template>

          <Steps
            class="setup-steps"
            :current="activeSetupIndex"
            :items="setupStepItems"
            responsive
            @change="selectSetupStep"
          />
          <Divider />
          <Tabs v-model:active-key="activeSetup" :items="setupTabItems" />

          <Row :gutter="[24, 18]">
            <Col :xs="24" :md="8">
              <Flex vertical :gap="12">
                <TypographyTitle :level="4">{{ activeSetupDetail.title }}</TypographyTitle>
                <TypographyParagraph type="secondary">
                  {{ activeSetupDetail.description }}
                </TypographyParagraph>
                <Flex vertical :gap="6">
                  <Space v-for="note in activeSetupDetail.notes" :key="note" :size="6">
                    <IconCheckLine class="note-icon" />
                    <TypographyText type="secondary">{{ note }}</TypographyText>
                  </Space>
                </Flex>
                <Button
                  v-if="activeSetupDetail.action === 'download'"
                  :href="downloadPath"
                  type="primary"
                  block
                  download="halo-cli.cjs"
                >
                  <template #icon><IconDownloadCloud2Line /></template>
                  下载 halo-cli.cjs
                </Button>
              </Flex>
            </Col>
            <Col :xs="24" :md="16">
              <TypographyParagraph
                class="command-output"
                :copyable="{
                  text: activeSetupDetail.command,
                  tooltips: ['复制命令', '复制成功'],
                }"
              >
                <pre>{{ activeSetupDetail.command }}</pre>
              </TypographyParagraph>
            </Col>
          </Row>
        </Card>

        <Row :gutter="[18, 18]" class="overview-row">
          <Col :xs="24" :xl="10">
            <Card class="section-card full-height" variant="borderless">
              <template #title>
                <Flex align="center" :gap="12">
                  <Avatar class="section-avatar" shape="square" :size="42">
                    <template #icon><IconCodeBoxLine /></template>
                  </Avatar>
                  <Flex vertical :gap="2">
                    <TypographyText strong>命令速查</TypographyText>
                    <TypographyText type="secondary">常用入口可直接复制。</TypographyText>
                  </Flex>
                </Flex>
              </template>

              <Collapse :items="commandGroups" :default-active-key="['content']" accordion ghost>
                <template #contentRender="{ item }">
                  <TypographyParagraph
                    class="command-output command-output--compact"
                    :copyable="{
                      text: String(item.content),
                      tooltips: ['复制命令', '复制成功'],
                    }"
                  >
                    <pre>{{ item.content }}</pre>
                  </TypographyParagraph>
                </template>
              </Collapse>
              <Button
                :href="`${repositoryUrl}#命令参考`"
                target="_blank"
                rel="noreferrer"
                type="link"
              >
                查看完整命令文档
                <template #icon><IconExternalLinkLine /></template>
              </Button>
            </Card>
          </Col>

          <Col :xs="24" :xl="14">
            <Card class="section-card full-height" variant="borderless">
              <template #title>
                <Flex align="center" :gap="12">
                  <Avatar class="section-avatar" shape="square" :size="42">
                    <template #icon><IconLayoutGridLine /></template>
                  </Avatar>
                  <Flex vertical :gap="2">
                    <TypographyText strong>能力地图</TypographyText>
                    <TypographyText type="secondary">
                      核心资源已经覆盖完整的读取和维护流程。
                    </TypographyText>
                  </Flex>
                </Flex>
              </template>

              <Descriptions
                bordered
                layout="vertical"
                size="small"
                :column="{ xs: 1, sm: 2, md: 2, lg: 3, xl: 2, xxl: 2 }"
              >
                <DescriptionsItem v-for="feature in featureGroups" :key="feature.title">
                  <template #label>
                    <Space :size="8">
                      <Avatar class="feature-avatar" shape="square" :size="28">
                        <template #icon><component :is="feature.icon" /></template>
                      </Avatar>
                      <TypographyText strong>{{ feature.title }}</TypographyText>
                    </Space>
                  </template>
                  <Flex vertical :gap="10">
                    <TypographyText type="secondary">{{ feature.description }}</TypographyText>
                    <Space :size="4" wrap>
                      <Tag v-for="command in feature.commands" :key="command" color="blue">
                        {{ command }}
                      </Tag>
                    </Space>
                  </Flex>
                </DescriptionsItem>
              </Descriptions>
            </Card>
          </Col>
        </Row>

        <Alert
          class="automation-alert"
          type="success"
          show-icon
          title="同一套命令，也可以运行在脚本和 CI 中"
          description="所有查询命令支持 --json；敏感响应默认脱敏，适合与 jq、GitHub Actions 等工具组合。"
        >
          <template #action>
            <Button :href="repositoryUrl" target="_blank" rel="noreferrer">
              阅读使用文档
              <template #icon><IconArrowRightLine /></template>
            </Button>
          </template>
        </Alert>

        <Divider class="page-divider" />
        <Flex class="page-footer" justify="space-between" align="center" gap="small" wrap>
          <TypographyText type="secondary">Halo CLI · 为 Halo 自动化而设计</TypographyText>
          <Space :size="4">
            <Tag>Node.js 20.19+</Tag>
            <Tag color="blue">v{{ currentVersion }}</Tag>
          </Space>
        </Flex>
      </Flex>
    </main>
  </ConfigProvider>
</template>

<style scoped>
.cli-page {
  --cli-ink: #171c25;
  --cli-paper: #fffefb;
  --cli-canvas: #f3f3ef;
  --cli-line: #d8dce3;
  --cli-primary: #425aef;
  --cli-terminal: #111722;
  --cli-terminal-line: #273040;
  --cli-terminal-text: #d8e1ef;
  --cli-green: #8ae234;
  min-height: 100%;
  padding: 24px 28px 40px;
  color: var(--cli-ink);
  background-color: var(--cli-canvas);
  background-image:
    linear-gradient(rgb(23 28 37 / 3%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(23 28 37 / 3%) 1px, transparent 1px);
  background-size: 32px 32px;
}

.cli-page__content {
  width: min(100%, 1280px);
  margin: 0 auto;
}

.utility-bar {
  min-height: 36px;
  padding: 0 4px;
}

.utility-bar__glyph {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--cli-paper);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  border-radius: 6px;
  background: var(--cli-ink);
}

.utility-bar__brand {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.utility-bar__brand :deep(.ant-typography) {
  font-size: 11px;
  letter-spacing: 0.12em;
}

.live-signal {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #4c5566;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.live-signal i,
.terminal-card__footer i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52c41a;
  box-shadow: 0 0 0 3px rgb(82 196 26 / 14%);
}

.hero-card {
  position: relative;
  overflow: hidden;
  color: var(--cli-ink);
  border: 1px solid #cfd3da;
  border-radius: 16px;
  background:
    linear-gradient(90deg, rgb(66 90 239 / 5%) 1px, transparent 1px),
    linear-gradient(rgb(66 90 239 / 5%) 1px, transparent 1px), var(--cli-paper);
  background-size: 40px 40px;
  box-shadow:
    0 1px 0 rgb(23 28 37 / 8%),
    0 24px 64px rgb(23 28 37 / 10%);
}

.hero-card__content {
  position: relative;
  z-index: 2;
  padding: 64px 60px 58px;
}

.hero-card__title {
  margin: 0 !important;
  color: var(--cli-ink) !important;
  font-family: 'Arial Narrow', 'Noto Sans SC', 'PingFang SC', sans-serif !important;
  font-size: clamp(48px, 6.4vw, 78px) !important;
  font-weight: 600 !important;
  line-height: 0.98 !important;
  letter-spacing: -0.065em;
}

.hero-card__description {
  max-width: 600px;
  margin: 0 !important;
  color: #505969 !important;
  font-size: 16px;
  line-height: 1.8;
}

.hero-card__meta {
  color: #707888;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.hero-card__meta > :deep(.ant-space-item:not(:last-child))::after {
  margin-inline-start: 16px;
  color: #b9bec8;
  content: '/';
}

.hero-card__watermark {
  position: absolute;
  top: -76px;
  left: 44%;
  z-index: 0;
  color: rgb(66 90 239 / 4%);
  font-family: 'Arial Narrow', sans-serif;
  font-size: 310px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.12em;
  pointer-events: none;
  user-select: none;
}

.hero-card__registration {
  position: absolute;
  z-index: 1;
  width: 42px;
  height: 42px;
  pointer-events: none;
}

.hero-card__registration::before,
.hero-card__registration::after {
  position: absolute;
  background: var(--cli-primary);
  content: '';
}

.hero-card__registration::before {
  top: 20px;
  left: 0;
  width: 42px;
  height: 1px;
}

.hero-card__registration::after {
  top: 0;
  left: 20px;
  width: 1px;
  height: 42px;
}

.hero-card__registration--top {
  top: -11px;
  right: 35%;
}

.hero-card__registration--bottom {
  right: -11px;
  bottom: 20%;
}

.terminal-card {
  overflow: hidden;
  border: 1px solid #30394a;
  border-radius: 12px;
  background: var(--cli-terminal);
  box-shadow:
    12px 12px 0 rgb(66 90 239 / 12%),
    0 20px 42px rgb(17 23 34 / 24%);
  transform: rotate(0.7deg);
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

.terminal-card:hover {
  box-shadow:
    8px 10px 0 rgb(66 90 239 / 14%),
    0 24px 50px rgb(17 23 34 / 28%);
  transform: translateY(-2px) rotate(0deg);
}

.terminal-card__bar {
  min-height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--cli-terminal-line);
  background: #181f2b;
}

.terminal-card__bar :deep(.ant-typography) {
  color: #8993a5;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 10px;
}

.terminal-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.terminal-dot--red {
  background: #ff6b6b;
}

.terminal-dot--amber {
  background: #fbbf24;
}

.terminal-dot--green {
  background: #52c41a;
}

.terminal-card__screen {
  overflow-x: auto;
  min-height: 276px;
  margin: 0;
  padding: 24px;
  color: var(--cli-terminal-text);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre;
}

.terminal-prompt,
.terminal-ok {
  color: var(--cli-green);
}

.terminal-key {
  color: #8ea2ff;
}

.terminal-muted {
  color: #667386;
}

.terminal-cursor {
  color: var(--cli-green);
  animation: cursor-blink 1.1s steps(2, jump-none) infinite;
}

.terminal-card__footer {
  padding: 9px 14px;
  color: #768196;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  border-top: 1px solid var(--cli-terminal-line);
  background: #151c27;
}

.terminal-card__footer > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #a3c788;
}

.hero-card__statistics {
  margin-top: 22px;
  border: 1px solid #d9dde5;
  background: rgb(255 254 251 / 88%);
}

.hero-card__statistics :deep(.ant-card-body) {
  padding: 16px 18px;
}

.hero-card__statistics :deep(.ant-col + .ant-col) {
  border-left: 1px solid #dfe2e8;
}

.runtime-alert,
.automation-alert {
  border-radius: 10px;
}

.runtime-alert {
  border-color: #c9d1f6;
  background: #f1f3ff;
}

.section-card {
  overflow: hidden;
  border: 1px solid var(--cli-line);
  background: var(--cli-paper);
  box-shadow: 0 8px 24px rgb(23 28 37 / 5%);
}

.section-card > :deep(.ant-card-head) {
  border-bottom-color: #e4e6eb;
  background: #faf9f5;
}

.section-avatar,
.feature-avatar {
  color: var(--cli-primary);
  background: #eef0ff;
}

.section-avatar {
  border: 1px solid #d4dafc;
}

.setup-steps {
  margin: 8px 0;
}

.setup-steps :deep(.ant-steps-item-content) {
  font-size: 12px;
}

.note-icon {
  flex: none;
  color: #3d7c0f;
}

.command-output {
  position: relative;
  overflow: hidden;
  margin: 0 !important;
  border: 1px solid #2c3544;
  border-radius: 8px;
  background: var(--cli-terminal);
}

.command-output pre {
  overflow-x: auto;
  margin: 0;
  padding: 20px 48px 20px 20px;
  color: var(--cli-terminal-text);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre;
}

.command-output :deep(.ant-typography-copy) {
  position: absolute;
  top: 12px;
  right: 14px;
  color: #a9b6d0;
}

.command-output :deep(.ant-typography-copy:hover) {
  color: var(--cli-green);
}

.command-output--compact pre {
  max-height: 270px;
  padding-top: 16px;
  padding-bottom: 16px;
  font-size: 12px;
}

.overview-row > :deep(.ant-col) {
  display: flex;
}

.full-height {
  width: 100%;
}

.full-height > :deep(.ant-card-body) {
  padding-top: 10px;
}

.full-height :deep(.ant-collapse-content-box) {
  padding: 4px 0 16px;
}

.full-height :deep(.ant-descriptions-item-content) {
  min-height: 110px;
}

.full-height :deep(.ant-descriptions-item-label) {
  background: #f7f6f1;
}

.full-height :deep(.ant-tag) {
  margin-inline-end: 0;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 10px;
}

.page-divider {
  margin: 4px 0 0;
}

.page-footer {
  padding: 0 4px;
}

@keyframes cursor-blink {
  50% {
    opacity: 0;
  }
}

@media (max-width: 768px) {
  .cli-page {
    padding: 14px;
  }

  .hero-card {
    border-radius: 12px;
  }

  .hero-card__content {
    padding: 38px 24px 32px;
  }

  .hero-card__title {
    font-size: clamp(42px, 14vw, 60px) !important;
  }

  .hero-card__statistics :deep(.ant-card-body) {
    padding: 16px 12px;
  }

  .terminal-card {
    transform: none;
  }

  .terminal-card__screen {
    min-height: 0;
    padding: 18px;
    font-size: 11px;
  }

  .setup-steps {
    display: none;
  }
}

@media (max-width: 480px) {
  .cli-page {
    padding: 10px;
  }

  .utility-bar__brand :deep(.ant-typography:last-child),
  .hero-card__meta {
    display: none;
  }

  .hero-actions,
  .hero-actions > :deep(.ant-space-item) {
    width: 100%;
  }

  .hero-actions :deep(.ant-btn) {
    width: 100%;
  }

  .hero-card__statistics :deep(.ant-statistic-content) {
    font-size: 17px !important;
  }

  .hero-card__statistics :deep(.ant-statistic-title) {
    font-size: 10px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .terminal-card,
  .terminal-cursor {
    animation: none;
    transition: none;
  }
}
</style>
