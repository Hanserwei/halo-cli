import type { CAC } from 'cac'

import { createHaloClient } from '../client.js'
import { loadConfig, normalizeUrl, saveConfig, validateToken } from '../config.js'
import { CliError } from '../errors.js'
import { printJson } from '../output.js'
import { required } from '../options.js'

interface LoginOptions {
  json?: boolean
  profile?: string
  skipVerify?: boolean
  token?: string
  tokenStdin?: boolean
  url?: string
}

interface ProfileOptions {
  json?: boolean
}


export function registerAuthCommands(cli: CAC): void {
  cli
    .command('login', '保存 Halo 地址和 CLI 密钥或个人令牌')
    .option('--profile <name>', '连接名称', { default: 'default' })
    .option('--url <url>', 'Halo 站点地址')
    .option('--token <token>', 'CLI 密钥或个人令牌')
    .option('--token-stdin', '从标准输入读取凭据（不能与 --token 同时使用）')
    .option('--skip-verify', '保存前不验证连接')
    .option('--json', '输出 JSON')
    .action(async (options: LoginOptions) => {
      const name = required(options.profile, '连接名称')
      if (options.tokenStdin && options.token !== undefined) {
        throw new CliError('--token-stdin 不能与 --token 同时使用。')
      }
      let input = options.token
      if (options.tokenStdin) {
        if (process.stdin.isTTY) {
          throw new CliError('--token-stdin 需要管道或重定向输入。')
        }
        let contents = ''
        try {
          for await (const chunk of process.stdin) {
            contents += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
            if (Buffer.byteLength(contents) > 16_384) {
              throw new CliError('标准输入凭据过长。')
            }
          }
        } catch {
          throw new CliError('无法读取标准输入凭据。')
        }
        input = contents.replace(/\r?\n$/, '')
      }
      const explicitCredentials = options.url !== undefined || options.token !== undefined || options.tokenStdin
      const url = normalizeUrl(required(explicitCredentials ? options.url : process.env.HALO_BASE_URL, 'Halo 地址（--url）'))
      const token = validateToken(explicitCredentials ? input : process.env.HALO_TOKEN)

      if (!options.skipVerify) {
        const connection = await createHaloClient({ token, url })
        if (token.startsWith('hcli_')) {
          const { data } = await connection.http.get('/apis/console.api.halo-cli.halo.run/v1alpha1/auth/me')
          if (!data || typeof data.username !== 'string' || !data.username
            || typeof data.keyName !== 'string' || !data.keyName
            || typeof data.keyDisplayName !== 'string'
            || !Array.isArray(data.scopes) || !data.scopes.every((scope: unknown) => typeof scope === 'string')) {
            throw new CliError('CLI 密钥验证响应无效。')
          }
        } else {
          await connection.http.get('/apis/api.console.halo.run/v1alpha1/users/-')
        }
      }

      const config = await loadConfig()
      Object.defineProperty(config.profiles, name, { value: { token, url }, enumerable: true, configurable: true, writable: true })
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
      const config = await loadConfig()
      const profiles = Object.entries(config.profiles).map(([name, profile]) => ({
        current: name === config.currentProfile,
        name,
        url: normalizeUrl(profile.url),
      }))
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
      const result = { name, url: normalizeUrl(profile.url) }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`${name}\t${result.url}\n`)
      }
    })

  cli
    .command('use <name>', '切换当前连接')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ProfileOptions) => {
      const config = await loadConfig()
      const profile = config.profiles[name]
      if (!profile) {
        throw new CliError('连接配置不存在。')
      }
      config.currentProfile = name
      await saveConfig(config)
      const result = { current: true, name, url: normalizeUrl(profile.url) }
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
