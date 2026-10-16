import axios from 'axios'
import type { CAC } from 'cac'

import { consoleActivatedThemePath, createHaloClient, extensionPath } from '../client.js'
import { addConfigurationConnectionOptions, registerExtensionConfigurationCommands } from '../configuration.js'
import { printJson } from '../output.js'
import type { ConnectionOptions, Theme } from '../types.js'

interface HanloOptions extends ConnectionOptions {
  json?: boolean
}

export function registerHanloCommands(cli: CAC): void {
  registerExtensionConfigurationCommands(cli, 'theme', 'theme-hanlo')

  addConfigurationConnectionOptions(cli.command('doctor', '检查 theme-hanlo 安装与激活状态'))
    .option('--json', '输出 JSON')
    .action(async (options: HanloOptions) => {
      const { http } = await createHaloClient(options)
      let theme: Theme | undefined
      let active: Theme | undefined
      try {
        theme = (await http.get<Theme>(extensionPath('theme.halo.run', 'themes', 'theme-hanlo'))).data
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error
      }
      try {
        active = (await http.get<Theme>(consoleActivatedThemePath())).data
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error
      }
      const result = {
        name: 'theme-hanlo',
        installed: Boolean(theme),
        active: active?.metadata.name === 'theme-hanlo',
        settingDeclared: Boolean(theme?.spec.settingName),
        configDeclared: Boolean(theme?.spec.configMapName),
        version: theme?.spec.version,
      }
      if (options.json) printJson(result)
      else process.stdout.write(`theme-hanlo：${result.installed ? '已安装' : '未安装'}，${result.active ? '已激活' : '未激活'}，${result.settingDeclared && result.configDeclared ? '配置声明完整' : '配置声明不完整'}。\n`)
    })
}
