import { randomUUID } from 'node:crypto'
import { chmod, link, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { CliError } from './errors.js'

const SENSITIVE_WORDS = new Set([
  'access',
  'authorization',
  'credential',
  'key',
  'password',
  'passphrase',
  'private',
  'secret',
  'token',
])

export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLocaleLowerCase()
  const words = normalized.split(/[-_.]/)
  return words.some((word) => SENSITIVE_WORDS.has(word)) || words.includes('api') && words.includes('key')
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactSecrets(entry),
    ]),
  )
}

export async function writeJsonExport(
  output: string,
  value: unknown,
  force = false,
): Promise<void> {
  const directory = dirname(output)
  const temporaryPath = `${output}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    if (force) {
      await rename(temporaryPath, output)
      await chmod(output, 0o600)
      return
    }
    await link(temporaryPath, output)
    await chmod(output, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(`导出目标已存在：${output}。如需替换，请显式使用 --force。`)
    }
    throw error
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}
