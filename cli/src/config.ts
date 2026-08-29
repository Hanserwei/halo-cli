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
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CliConfig>
    return {
      currentProfile: parsed.currentProfile,
      profiles: parsed.profiles ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(EMPTY_CONFIG)
    }
    if (error instanceof SyntaxError) {
      throw new CliError(`配置文件格式错误：${path}`)
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
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError(`无效的 Halo 地址：${value}`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new CliError('Halo 地址必须使用 http 或 https 协议。')
  }

  return url.toString().replace(/\/$/, '')
}

export async function resolveProfile(
  options: ConnectionOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ name: string; profile: Profile }> {
  const url = options.url?.trim() || environment.HALO_BASE_URL?.trim()
  const token = options.token?.trim() || environment.HALO_TOKEN?.trim()

  if (url || token) {
    if (!url || !token) {
      throw new CliError('临时连接必须同时提供 Halo 地址和个人令牌。')
    }
    return { name: 'environment', profile: { url: normalizeUrl(url), token } }
  }

  const config = await loadConfig()
  const name = options.profile?.trim() || environment.HALO_PROFILE?.trim() || config.currentProfile
  if (!name) {
    throw new CliError('尚未配置 Halo。请先运行 `halo-cli auth login`。')
  }

  const profile = config.profiles[name]
  if (!profile) {
    throw new CliError(`连接配置不存在：${name}`)
  }
  return { name, profile }
}
