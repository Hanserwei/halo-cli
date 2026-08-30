import axios from 'axios'
import type { CAC } from 'cac'

import {
  consoleActivatedThemePath,
  consoleThemePath,
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
import { printJson, printTheme, printThemeList } from '../output.js'
import { printOrExportJson } from '../structured-output.js'
import type {
  ConnectionOptions,
  Page,
  Setting,
  Theme,
} from '../types.js'
import type { StructuredOutputOptions } from '../structured-output.js'

interface ThemeOptions extends ConnectionOptions, StructuredOutputOptions {
  file?: unknown
  keyword?: unknown
  page?: string
  replace?: boolean
  size?: string
  uninstalled?: boolean | string
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

async function getTheme(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  name: string,
): Promise<Theme> {
  return (await http.get<Theme>(extensionPath('theme.halo.run', 'themes', name))).data
}

async function getActiveTheme(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
): Promise<Theme | undefined> {
  try {
    return (await http.get<Theme>(consoleActivatedThemePath())).data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return undefined
    throw error
  }
}

function requireSettingName(theme: Theme): string {
  return required(theme.spec.settingName, `主题 ${theme.metadata.name} 未声明设置 Schema。`)
}

function requireConfigMapName(theme: Theme): string {
  return required(theme.spec.configMapName, `主题 ${theme.metadata.name} 未声明配置。`)
}

async function fetchThemeConfig(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  name: string,
): Promise<unknown> {
  const theme = await getTheme(http, name)
  requireConfigMapName(theme)
  const response = await http.get<Record<string, unknown>>(consoleThemePath(name, 'json-config'))
  return response.data ?? {}
}

function requireThemeConfigObject(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw new CliError('主题配置不是 JSON 对象，无法修改。')
  return value
}

export function registerThemeCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '发现已安装主题'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--uninstalled <boolean>', '是否包含未安装主题，true 或 false')
    .option('--json', '输出 JSON')
    .action(async (options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      const [response, active] = await Promise.all([
        http.get<Page<Theme>>(consoleThemePath(), {
          params: {
            page: positiveInteger(options.page, 1),
            size: positiveInteger(options.size, 50),
            uninstalled:
              options.uninstalled === undefined
                ? undefined
                : booleanValue(options.uninstalled, '--uninstalled'),
          },
        }),
        getActiveTheme(http),
      ])
      printThemeList(response.data, active?.metadata.name, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看主题'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      const [theme, active] = await Promise.all([getTheme(http, name), getActiveTheme(http)])
      printTheme(theme, active?.metadata.name, options.json)
    })

  addConnectionOptions(cli.command('current', '查看当前主题'))
    .option('--json', '输出 JSON')
    .action(async (options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      const theme = await getActiveTheme(http)
      if (!theme) throw new CliError('当前没有已激活的主题。')
      if (options.json) printJson(theme)
      else printTheme(theme, theme.metadata.name)
    })

  addConnectionOptions(cli.command('activate <name>', '激活主题'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      await http.put(consoleThemePath(name, 'activation'))
      const theme = await getTheme(http, name)
      if (options.json) printJson(theme)
      else process.stdout.write(`主题 ${name} 已激活。\n`)
    })

  addConnectionOptions(cli.command('reload <name>', '重载主题'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      await http.put(consoleThemePath(name, 'reload'))
      const theme = await getTheme(http, name)
      if (options.json) printJson(theme)
      else process.stdout.write(`主题 ${name} 已重载。\n`)
    })

  addConnectionOptions(cli.command('invalidate-cache <name>', '清除主题模板缓存'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      await http.put(consoleThemePath(name, 'invalidate-cache'))
      if (options.json) printJson({ invalidated: true, name })
      else process.stdout.write(`主题 ${name} 的模板缓存已清除。\n`)
    })

  addConnectionOptions(cli.command('templates <name>', '列出主题自定义页面模板'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      const theme = await getTheme(http, name)
      const templates = theme.spec.customTemplates ?? {}
      if (options.json) printJson(templates)
      else {
        for (const [type, items] of Object.entries(templates)) {
          for (const template of items) {
            process.stdout.write(`${type.padEnd(10)} ${template.file.padEnd(24)} ${template.name}\n`)
          }
        }
      }
    })

  addConnectionOptions(
    addStructuredOptions(cli.command('setting <name>', '查看主题配置 Schema')),
  ).action(async (name: string, options: ThemeOptions) => {
    const { http } = await createHaloClient(options)
    const theme = await getTheme(http, name)
    requireSettingName(theme)
    const setting = (await http.get<Setting>(consoleThemePath(name, 'setting'))).data
    await printOrExportJson(setting, { ...options, redact: false }, '主题配置 Schema')
  })

  addConnectionOptions(addConfigOptions(cli.command('config <name>', '读取主题当前配置'))).action(
    async (name: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      await printOrExportJson(await fetchThemeConfig(http, name), options, '主题配置')
    },
  )

  addConnectionOptions(cli.command('config-export <name>', '导出主题当前配置'))
    .option('--output <file>', '导出 JSON 文件路径')
    .option('--force', '允许替换已有导出文件')
    .option('--include-secrets', '导出未脱敏的敏感字段；必须同时指定 --output')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const output = textValue(options.output, '--output')
      if (!output) throw new CliError('config-export 必须指定 --output <file>。')
      const { http } = await createHaloClient(options)
      await printOrExportJson(await fetchThemeConfig(http, name), options, '主题配置')
    })

  addConnectionOptions(
    cli.command('config-set <name> <pointer> <value>', '按 JSON Pointer 修改一个主题配置字段'),
  )
    .option('--json', '输出 JSON')
    .action(async (name: string, pointer: string, value: string, options: ThemeOptions) => {
      const { http } = await createHaloClient(options)
      const current = requireThemeConfigObject(await fetchThemeConfig(http, name))
      const updated = setJsonPointer(current, pointer, parseJsonValue(value))
      const response = await http.put<Record<string, unknown>>(
        consoleThemePath(name, 'json-config'),
        updated,
      )
      await printOrExportJson(
        isJsonObject(response.data) ? response.data : updated,
        options,
        '主题配置',
      )
    })

  addConnectionOptions(cli.command('config-import <name>', '从 JSON 文件合并或替换主题配置'))
    .option('--file <path>', '配置 JSON 文件路径')
    .option('--replace', '替换完整配置；默认递归合并')
    .option('--yes', '确认完整替换')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      const file = required(textValue(options.file, '--file'), '配置文件（--file）')
      const imported = await readJsonObject(file, '主题配置文件')
      if (containsRedactedValue(imported)) {
        throw new CliError('配置文件包含 [REDACTED]，拒绝写入以免覆盖真实凭据。')
      }
      const { http } = await createHaloClient(options)
      const current = requireThemeConfigObject(await fetchThemeConfig(http, name))
      if (options.replace) {
        requireConfirmation(options.yes, `halo-cli theme config-import ${name} --replace`)
      }
      const updated = options.replace ? imported : mergeJsonObjects(current, imported)
      const response = await http.put<Record<string, unknown>>(
        consoleThemePath(name, 'json-config'),
        updated,
      )
      await printOrExportJson(
        isJsonObject(response.data) ? response.data : updated,
        options,
        '主题配置',
      )
    })

  addConnectionOptions(cli.command('config-reset <name>', '将主题配置恢复为 Schema 默认值'))
    .option('--yes', '确认重置')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ThemeOptions) => {
      requireConfirmation(options.yes, `halo-cli theme config-reset ${name}`)
      const { http } = await createHaloClient(options)
      await http.put(consoleThemePath(name, 'reset-config'))
      await printOrExportJson(await fetchThemeConfig(http, name), options, '主题配置')
    })
}
