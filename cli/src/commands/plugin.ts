import type { CAC } from 'cac'

import {
  consolePluginPath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { CliError } from '../errors.js'
import {
  containsRedactedValue,
  isJsonObject,
  mergeJsonObjects,
  parseJsonValue,
  readJsonObject,
  setJsonPointer,
} from '../json-input.js'
import {
  booleanValue,
  positiveInteger,
  required,
  requireConfirmation,
  textValue,
} from '../options.js'
import { printJson, printPlugin, printPluginList } from '../output.js'
import { printOrExportJson } from '../structured-output.js'
import type {
  ConnectionOptions,
  Page,
  Plugin,
  Setting,
} from '../types.js'
import type { StructuredOutputOptions } from '../structured-output.js'

interface PluginOptions extends ConnectionOptions, StructuredOutputOptions {
  async?: boolean | string
  enabled?: boolean | string
  file?: unknown
  keyword?: unknown
  page?: string
  replace?: boolean
  size?: string
  yes?: boolean
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

function requirePluginConfigObject(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw new CliError('插件配置不是 JSON 对象，无法修改。')
  return value
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

  for (const action of ['enable', 'disable'] as const) {
    addConnectionOptions(
      cli.command(`${action} <name>`, action === 'enable' ? '启用插件' : '停用插件'),
    )
      .option('--async <boolean>', '是否异步切换状态，true 或 false（默认 false）')
      .option('--json', '输出 JSON')
      .action(async (name: string, options: PluginOptions) => {
        const { http } = await createHaloClient(options)
        await http.put(consolePluginPath(name, 'plugin-state'), {
          async: booleanValue(options.async, '--async') ?? false,
          enable: action === 'enable',
        })
        const plugin = await getPlugin(http, name)
        if (options.json) printJson(plugin)
        else process.stdout.write(`插件 ${name} 已${action === 'enable' ? '启用' : '停用'}。\n`)
      })
  }

  addConnectionOptions(cli.command('reload <name>', '重载插件'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PluginOptions) => {
      const { http } = await createHaloClient(options)
      await http.put(consolePluginPath(name, 'reload'))
      const plugin = await getPlugin(http, name)
      if (options.json) printJson(plugin)
      else process.stdout.write(`插件 ${name} 已重载。\n`)
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

  addConnectionOptions(
    cli.command('config-set <name> <pointer> <value>', '按 JSON Pointer 修改一个插件配置字段'),
  )
    .option('--json', '输出 JSON')
    .action(async (name: string, pointer: string, value: string, options: PluginOptions) => {
      const { http } = await createHaloClient(options)
      const current = requirePluginConfigObject(await fetchPluginConfig(http, name))
      const updated = setJsonPointer(current, pointer, parseJsonValue(value))
      const response = await http.put<Record<string, unknown>>(
        consolePluginPath(name, 'json-config'),
        updated,
      )
      await printPluginConfigUsage(isJsonObject(response.data) ? response.data : updated, options)
    })

  addConnectionOptions(cli.command('config-import <name>', '从 JSON 文件合并或替换插件配置'))
    .option('--file <path>', '配置 JSON 文件路径')
    .option('--replace', '替换完整配置；默认递归合并')
    .option('--yes', '确认完整替换')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PluginOptions) => {
      const file = required(textValue(options.file, '--file'), '配置文件（--file）')
      const imported = await readJsonObject(file, '插件配置文件')
      if (containsRedactedValue(imported)) {
        throw new CliError('配置文件包含 [REDACTED]，拒绝写入以免覆盖真实凭据。')
      }
      const { http } = await createHaloClient(options)
      const current = requirePluginConfigObject(await fetchPluginConfig(http, name))
      if (options.replace) {
        requireConfirmation(options.yes, `halo-cli plugin config-import ${name} --replace`)
      }
      const updated = options.replace ? imported : mergeJsonObjects(current, imported)
      const response = await http.put<Record<string, unknown>>(
        consolePluginPath(name, 'json-config'),
        updated,
      )
      await printPluginConfigUsage(isJsonObject(response.data) ? response.data : updated, options)
    })

  addConnectionOptions(cli.command('config-reset <name>', '将插件配置恢复为 Schema 默认值'))
    .option('--yes', '确认重置')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PluginOptions) => {
      requireConfirmation(options.yes, `halo-cli plugin config-reset ${name}`)
      const { http } = await createHaloClient(options)
      await http.put(consolePluginPath(name, 'reset-config'))
      await printPluginConfigUsage(await fetchPluginConfig(http, name), options)
    })
}
