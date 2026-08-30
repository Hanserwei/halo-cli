import type { CAC } from 'cac'

import {
  consolePluginPath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { CliError } from '../errors.js'
import { booleanValue, positiveInteger, required, textValue } from '../options.js'
import { printPlugin, printPluginList } from '../output.js'
import { printOrExportJson } from '../structured-output.js'
import type {
  ConnectionOptions,
  Page,
  Plugin,
  Setting,
} from '../types.js'
import type { StructuredOutputOptions } from '../structured-output.js'

interface PluginOptions extends ConnectionOptions, StructuredOutputOptions {
  enabled?: boolean | string
  keyword?: unknown
  page?: string
  size?: string
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

function addStructuredOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--output <file>', '将 JSON 写入文件；默认不覆盖已有文件')
    .option('--force', '允许替换已有导出文件')
    .option('--json', '输出 JSON')
}

function addConfigOptions(command: ReturnType<CAC['command']>) {
  return addStructuredOptions(command).option(
    '--include-secrets',
    '导出未脱敏的敏感字段；必须同时指定 --output',
  )
}

async function getPlugin(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  name: string,
): Promise<Plugin> {
  return (await http.get<Plugin>(extensionPath('plugin.halo.run', 'plugins', name))).data
}

function requireSettingName(plugin: Plugin): string {
  return required(plugin.spec.settingName, `插件 ${plugin.metadata.name} 未声明设置 Schema。`)
}

function requireConfigMapName(plugin: Plugin): string {
  return required(plugin.spec.configMapName, `插件 ${plugin.metadata.name} 未声明配置。`)
}

async function fetchPluginConfig(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  name: string,
): Promise<unknown> {
  const plugin = await getPlugin(http, name)
  requireConfigMapName(plugin)
  const response = await http.get<Record<string, unknown>>(consolePluginPath(name, 'json-config'))
  return response.data ?? {}
}

function printPluginConfigUsage(
  value: unknown,
  options: PluginOptions,
): Promise<void> {
  return printOrExportJson(value, options, '插件配置')
}

export function registerPluginCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '发现已安装插件'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--keyword <keyword>', '按显示名称或描述筛选')
    .option('--enabled <boolean>', '按启用状态筛选，true 或 false')
    .option('--json', '输出 JSON')
    .action(async (options: PluginOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Page<Plugin>>(consolePluginPath(), {
        params: {
          enabled: options.enabled === undefined ? undefined : booleanValue(options.enabled, '--enabled'),
          keyword: textValue(options.keyword, '--keyword')?.trim() || undefined,
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 50),
        },
      })
      printPluginList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看插件'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PluginOptions) => {
      const { http } = await createHaloClient(options)
      printPlugin(await getPlugin(http, name), options.json)
    })

  addConnectionOptions(
    addStructuredOptions(cli.command('setting <name>', '查看插件配置 Schema')),
  ).action(async (name: string, options: PluginOptions) => {
    const { http } = await createHaloClient(options)
    const plugin = await getPlugin(http, name)
    requireSettingName(plugin)
    const setting = (await http.get<Setting>(consolePluginPath(name, 'setting'))).data
    await printOrExportJson(setting, { ...options, redact: false }, '插件配置 Schema')
  })

  addConnectionOptions(addConfigOptions(cli.command('config <name>', '读取插件当前配置'))).action(
    async (name: string, options: PluginOptions) => {
      const { http } = await createHaloClient(options)
      await printPluginConfigUsage(await fetchPluginConfig(http, name), options)
    },
  )

  addConnectionOptions(cli.command('config-export <name>', '导出插件当前配置'))
    .option('--output <file>', '导出 JSON 文件路径')
    .option('--force', '允许替换已有导出文件')
    .option('--include-secrets', '导出未脱敏的敏感字段；必须同时指定 --output')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PluginOptions) => {
      const output = textValue(options.output, '--output')
      if (!output) throw new CliError('config-export 必须指定 --output <file>。')
      const { http } = await createHaloClient(options)
      await printPluginConfigUsage(await fetchPluginConfig(http, name), options)
    })
}
