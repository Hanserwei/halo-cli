import axios from 'axios'
import type { CAC } from 'cac'

import {
  consoleActivatedThemePath,
  consolePluginPath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { CliError } from '../errors.js'
import { printJson } from '../output.js'
import type { ConnectionOptions, Page, Plugin, Theme } from '../types.js'

interface HaoOptions extends ConnectionOptions {
  json?: boolean
}

const expectedThemeVersion = '1.7.3'

const pluginCapabilities = [
  { feature: '默认评论', name: 'PluginCommentWidget', optional: false },
  { feature: '站内搜索', name: 'PluginSearchWidget', optional: false },
  { feature: '友情链接', name: 'PluginLinks', optional: false },
  { feature: '瞬间', name: 'PluginMoments', optional: false },
  { feature: 'Bilibili 追番', name: 'plugin-bilibili-bangumi', optional: false },
  { feature: '图库', name: 'PluginPhotos', optional: false },
  { feature: 'KaTeX', name: 'plugin-katex', optional: false },
  { feature: '装备', name: 'equipment', optional: false },
  { feature: 'Markdown / HTML 内容块', name: 'hybrid-edit-block', optional: false },
  { feature: '爱发电', name: 'plugin-afdian', optional: false },
  { feature: 'RSS 订阅', name: 'PluginFeed', optional: true },
  { feature: 'PrismJS', name: 'PluginPrismJS', optional: true },
  { feature: '平台同步', name: 'plugin-platforms-sync', optional: true },
  { feature: '友链自助申请', name: 'link-submit', optional: true },
] as const

const annotationCatalog = [
  {
    fields: ['ai', 'copyrightEnable', 'copyrightType', 'copyrightUrl', 'sync_status'],
    resource: 'content.halo.run/v1alpha1/posts',
    target: 'Post',
  },
  {
    fields: ['icon', 'isVertical'],
    resource: 'v1alpha1/menuitems',
    target: 'MenuItem',
  },
  {
    fields: ['displayStyle', 'description'],
    preset: 'link-group',
    resource: 'core.halo.run/v1alpha1/linkgroups',
    target: 'LinkGroup',
  },
  {
    fields: ['siteshot', 'label', 'labelColor'],
    preset: 'link',
    resource: 'core.halo.run/v1alpha1/links',
    target: 'Link',
  },
  {
    fields: ['cover', 'background', 'description'],
    preset: 'photo-group',
    resource: 'core.halo.run/v1alpha1/photogroups',
    target: 'PhotoGroup',
  },
] as const

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

async function optionalGet<T>(request: Promise<{ data: T }>): Promise<T | undefined> {
  try {
    return (await request).data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return undefined
    throw error
  }
}

function themeTemplates(theme: Theme | undefined) {
  return theme?.spec.customTemplates?.page ?? []
}

export function registerHaoCommands(cli: CAC): void {
  addConnectionOptions(cli.command('doctor', '检查 Hao 1.7.3 和常用插件的本机适配状态'))
    .option('--json', '输出 JSON')
    .action(async (options: HaoOptions) => {
      const { http } = await createHaloClient(options)
      const [plugins, activeTheme, haoTheme] = await Promise.all([
        http.get<Page<Plugin>>(consolePluginPath(), { params: { page: 1, size: 200 } }),
        optionalGet(http.get<Theme>(consoleActivatedThemePath())),
        optionalGet(http.get<Theme>(extensionPath('theme.halo.run', 'themes', 'theme-hao'))),
      ])
      const installedPlugins = new Map(
        plugins.data.items.map((plugin) => [plugin.metadata.name, plugin]),
      )
      const capabilities = pluginCapabilities.map(({ feature, name, optional }) => {
        const plugin = installedPlugins.get(name)
        return {
          enabled: plugin?.spec.enabled === true,
          feature,
          installed: Boolean(plugin),
          name,
          optional,
          version: plugin?.spec.version,
        }
      })
      const warnings: string[] = []
      if (!haoTheme) warnings.push('未安装 theme-hao。')
      if (activeTheme?.metadata.name !== 'theme-hao') warnings.push('当前激活主题不是 theme-hao。')
      if (haoTheme?.spec.version !== expectedThemeVersion) {
        warnings.push(
          `已核验版本为 ${expectedThemeVersion}，当前安装版本为 ${haoTheme?.spec.version ?? '未知'}。`,
        )
      }
      for (const capability of capabilities) {
        if (!capability.installed) {
          if (!capability.optional) warnings.push(`${capability.feature}：未安装 ${capability.name}。`)
        } else if (!capability.enabled) {
          warnings.push(`${capability.feature}：插件 ${capability.name} 未启用。`)
        }
      }
      const result = {
        annotations: annotationCatalog,
        compatible: Boolean(
          haoTheme &&
            activeTheme?.metadata.name === 'theme-hao' &&
            haoTheme.spec.version === expectedThemeVersion,
        ),
        plugins: capabilities,
        templates: themeTemplates(haoTheme),
        theme: {
          active: activeTheme?.metadata.name,
          expected: 'theme-hao',
          expectedVersion: expectedThemeVersion,
          installed: Boolean(haoTheme),
          version: haoTheme?.spec.version,
        },
        warnings,
      }
      if (options.json) {
        printJson(result)
        return
      }

      process.stdout.write(
        `Hao：${result.theme.installed ? `已安装 ${result.theme.version}` : '未安装'}，` +
          `当前主题：${result.theme.active ?? '无'}\n`,
      )
      for (const capability of capabilities) {
        const state = !capability.installed
          ? capability.optional
            ? 'optional'
            : 'missing'
          : capability.enabled
            ? 'enabled'
            : 'disabled'
        process.stdout.write(
          `${state.padEnd(8)} ${capability.feature.padEnd(20)} ${capability.name}` +
            `${capability.version ? ` ${capability.version}` : ''}\n`,
        )
      }
      if (warnings.length) {
        process.stdout.write(`\n提示：\n${warnings.map((warning) => `- ${warning}`).join('\n')}\n`)
      } else {
        process.stdout.write('\nHao 1.7.3 与全部已声明插件均已安装并启用。\n')
      }
    })

  addConnectionOptions(cli.command('templates', '列出 Hao 自定义页面模板'))
    .option('--json', '输出 JSON')
    .action(async (options: HaoOptions) => {
      const { http } = await createHaloClient(options)
      const theme = await optionalGet(
        http.get<Theme>(extensionPath('theme.halo.run', 'themes', 'theme-hao')),
      )
      if (!theme) throw new CliError('未安装 theme-hao。')
      const templates = themeTemplates(theme)
      if (options.json) printJson(templates)
      else {
        for (const template of templates) {
          process.stdout.write(`${template.file.padEnd(24)} ${template.name} — ${template.description ?? '-'}\n`)
        }
      }
    })

  cli.command('annotations', '列出 Hao 扩展字段及对应资源')
    .option('--json', '输出 JSON')
    .action((options: HaoOptions) => {
      if (options.json) printJson(annotationCatalog)
      else {
        for (const entry of annotationCatalog) {
          process.stdout.write(`${entry.target.padEnd(12)} ${entry.fields.join(', ')}\n`)
        }
      }
    })
}
