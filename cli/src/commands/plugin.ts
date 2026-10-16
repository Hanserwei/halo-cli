import type { AxiosInstance } from 'axios'
import type { CAC, Command } from 'cac'

import {
  consolePluginPath,
  createHaloClient,
  extensionPath,
} from '../client.js'
import { registerExtensionConfigurationCommands } from '../configuration.js'
import {
  booleanValue,
  positiveInteger,
  textValue,
} from '../options.js'
import { printJson, printPlugin, printPluginList } from '../output.js'
import type {
  ConnectionOptions,
  Page,
  Plugin,
} from '../types.js'

interface PluginOptions extends ConnectionOptions {
  json?: boolean
  async?: boolean | string
  enabled?: boolean | string
  keyword?: unknown
  page?: string
  size?: string
}

function addConnectionOptions(command: Command) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}


async function getPlugin(
  http: AxiosInstance,
  name: string,
): Promise<Plugin> {
  return (await http.get<Plugin>(extensionPath('plugin.halo.run', 'plugins', name))).data
}


export function registerPluginCommands(cli: CAC): void {
  registerExtensionConfigurationCommands(cli, 'plugin')
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

}
