import type { CAC } from 'cac'

import { createHaloClient } from '../client.js'
import { loadConfig, normalizeUrl, saveConfig } from '../config.js'
import { CliError } from '../errors.js'
import { printJson } from '../output.js'
import { required } from '../options.js'

interface LoginOptions {
  json?: boolean
  profile?: string
  skipVerify?: boolean
  token?: string
  url?: string
}

interface ProfileOptions {
  json?: boolean
}

function safeProfiles(config: Awaited<ReturnType<typeof loadConfig>>) {
  return Object.entries(config.profiles).map(([name, profile]) => ({
    current: name === config.currentProfile,
    name,
    url: profile.url,
  }))
}

export function registerAuthCommands(cli: CAC): void {
  cli
    .command('login', '保存 Halo 地址和个人令牌')
    .option('--profile <name>', '连接名称', { default: 'default' })
    .option('--url <url>', 'Halo 站点地址')
    .option('--token <token>', '以 pat_ 开头的个人令牌')
    .option('--skip-verify', '保存前不验证连接')
    .option('--json', '输出 JSON')
    .action(async (options: LoginOptions) => {
      const name = required(options.profile, '连接名称')
      const url = normalizeUrl(required(options.url, 'Halo 地址（--url）'))
      const token = required(options.token, '个人令牌（--token）')

      if (!options.skipVerify) {
        const connection = await createHaloClient({ token, url })
        await connection.http.get('/apis/api.console.halo.run/v1alpha1/users/-')
      }

      const config = await loadConfig()
      config.profiles[name] = { token, url }
      config.currentProfile = name
      await saveConfig(config)

      const result = { current: true, name, url, verified: !options.skipVerify }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`已保存并启用连接 ${name} (${url})。\n`)
      }
    })

  cli
    .command('list', '列出已保存的连接')
    .option('--json', '输出 JSON')
    .action(async (options: ProfileOptions) => {
      const profiles = safeProfiles(await loadConfig())
      if (options.json) {
        printJson(profiles)
        return
      }
      if (profiles.length === 0) {
        process.stdout.write('尚未保存任何连接。\n')
        return
      }
      for (const profile of profiles) {
        process.stdout.write(`${profile.current ? '*' : ' '} ${profile.name}\t${profile.url}\n`)
      }
    })

  cli
    .command('current', '显示当前连接')
    .option('--json', '输出 JSON')
    .action(async (options: ProfileOptions) => {
      const config = await loadConfig()
      const name = config.currentProfile
      const profile = name ? config.profiles[name] : undefined
      if (!name || !profile) {
        throw new CliError('尚未选择连接。请先运行 `halo-cli auth login`。')
      }
      const result = { name, url: profile.url }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`${name}\t${profile.url}\n`)
      }
    })

  cli
    .command('use <name>', '切换当前连接')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ProfileOptions) => {
      const config = await loadConfig()
      const profile = config.profiles[name]
      if (!profile) {
        throw new CliError(`连接配置不存在：${name}`)
      }
      config.currentProfile = name
      await saveConfig(config)
      const result = { current: true, name, url: profile.url }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`已切换到连接 ${name}。\n`)
      }
    })

  cli
    .command('logout [name]', '删除连接和对应令牌')
    .option('--json', '输出 JSON')
    .action(async (name: string | undefined, options: ProfileOptions) => {
      const config = await loadConfig()
      const target = name?.trim() || config.currentProfile
      if (!target || !config.profiles[target]) {
        throw new CliError('没有可删除的连接。')
      }
      delete config.profiles[target]
      if (config.currentProfile === target) {
        config.currentProfile = Object.keys(config.profiles)[0]
      }
      await saveConfig(config)
      const result = { currentProfile: config.currentProfile ?? null, deleted: true, name: target }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`已删除连接 ${target}。\n`)
      }
    })
}
