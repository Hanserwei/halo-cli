import axios from 'axios'
import type { CAC } from 'cac'

import {
  consoleActivatedThemePath,
  consoleThemePath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { CliError } from '../errors.js'
import { booleanValue, positiveInteger, required, textValue } from '../options.js'
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
  keyword?: unknown
  page?: string
  size?: string
  uninstalled?: boolean | string
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
}
