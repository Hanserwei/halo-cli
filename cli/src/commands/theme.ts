import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type { CAC, Command } from 'cac'

import {
  consoleActivatedThemePath,
  consoleThemePath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { CliError } from '../errors.js'
import { registerExtensionConfigurationCommands } from '../configuration.js'
import {
  booleanValue,
  positiveInteger,
} from '../options.js'
import { printJson, printTheme, printThemeList } from '../output.js'
import type {
  ConnectionOptions,
  Page,
  Theme,
} from '../types.js'

interface ThemeOptions extends ConnectionOptions {
  json?: boolean
  page?: string
  size?: string
  uninstalled?: boolean | string
}

function addConnectionOptions(command: Command) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}


async function getTheme(
  http: AxiosInstance,
  name: string,
): Promise<Theme> {
  return (await http.get<Theme>(extensionPath('theme.halo.run', 'themes', name))).data
}

async function getActiveTheme(
  http: AxiosInstance,
): Promise<Theme | undefined> {
  try {
    return (await http.get<Theme>(consoleActivatedThemePath())).data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return undefined
    throw error
  }
}


export function registerThemeCommands(cli: CAC): void {
  registerExtensionConfigurationCommands(cli, 'theme')
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

}
