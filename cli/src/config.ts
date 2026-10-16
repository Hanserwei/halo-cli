import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { CliError } from './errors.js'
import type { CliConfig, ConnectionOptions, Profile } from './types.js'

const EMPTY_CONFIG: CliConfig = { profiles: {} }

export function configPath(environment: NodeJS.ProcessEnv = process.env): string {
  const explicitDirectory = environment.HALO_CLI_CONFIG_DIR?.trim()
  if (explicitDirectory) {
    return join(explicitDirectory, 'config.json')
  }

  const xdgDirectory = environment.XDG_CONFIG_HOME?.trim()
  return join(xdgDirectory || join(homedir(), '.config'), 'halo-cli', 'config.json')
}

export async function loadConfig(path = configPath()): Promise<CliConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CliConfig> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || (parsed.currentProfile !== undefined && typeof parsed.currentProfile !== 'string')
      || (parsed.profiles !== undefined && (!parsed.profiles || typeof parsed.profiles !== 'object' || Array.isArray(parsed.profiles)))) {
      throw new CliError('配置文件格式错误。')
    }
    for (const profile of Object.values(parsed.profiles ?? {})) {
      if (!profile || typeof profile !== 'object') {
        throw new CliError('配置文件中的连接格式错误。')
      }
      normalizeUrl(profile.url)
      validateToken(profile.token)
    }
    return { currentProfile: parsed.currentProfile, profiles: parsed.profiles ?? {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(EMPTY_CONFIG)
    }
    if (error instanceof SyntaxError) {
      throw new CliError('配置文件格式错误。')
    }
    throw error
  }
}

export async function saveConfig(config: CliConfig, path = configPath()): Promise<void> {
  const directory = dirname(path)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, path)
  await chmod(path, 0o600)
}

export function normalizeUrl(value: string): string {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/u.test(value)) {
    throw new CliError('无效的 Halo 地址。')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError('无效的 Halo 地址。')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new CliError('Halo 地址必须使用 http 或 https 协议。')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CliError('Halo 地址不能包含用户名、密码、查询参数或片段。')
  }

  return url.toString().replace(/\/$/, '')
}

export function validateToken(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(value)) {
    throw new CliError('凭据不能为空、超过 4096 个字符或包含空白、控制字符。')
  }
  return value
}

export async function resolveProfile(
  options: ConnectionOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ name: string; profile: Profile }> {
  // A source supplies a complete pair; never borrow a token or URL from another source.
  const explicitProfile = options.profile !== undefined
  const explicitCredentials = options.url !== undefined || options.token !== undefined
  if (explicitCredentials) {
    if (!options.url || !options.token) {
      throw new CliError('临时连接必须同时提供 Halo 地址和凭据。')
    }
    return { name: 'options', profile: { url: normalizeUrl(options.url), token: validateToken(options.token) } }
  }
  if (!explicitProfile && (environment.HALO_BASE_URL !== undefined || environment.HALO_TOKEN !== undefined)) {
    if (!environment.HALO_BASE_URL || !environment.HALO_TOKEN) {
      throw new CliError('环境变量必须同时提供 Halo 地址和凭据。')
    }
    return { name: 'environment', profile: { url: normalizeUrl(environment.HALO_BASE_URL), token: validateToken(environment.HALO_TOKEN) } }
  }

  const config = await loadConfig(configPath(environment))
  const name = options.profile?.trim() || environment.HALO_PROFILE?.trim() || config.currentProfile
  if (explicitProfile && !options.profile?.trim()) {
    throw new CliError('连接名称不能为空。')
  }
  if (!name) {
    throw new CliError('尚未配置 Halo。请先运行 `halo-cli auth login`。')
  }
  const profile = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined
  if (!profile) {
    throw new CliError('连接配置不存在。')
  }
  return { name, profile: { url: normalizeUrl(profile.url), token: validateToken(profile.token) } }
}
