import { CliError } from './errors.js'

export function positiveInteger(value: string | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new CliError(`必须是大于 0 的整数：${value}`)
  }
  return parsed
}

export function integer(value: string | number | undefined, fallback = 0): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new CliError(`必须是整数：${value}`)
  }
  return parsed
}

export function textValue(value: unknown, optionName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  if (value === 0) {
    return ''
  }
  if (Array.isArray(value) && value.length === 0) {
    return ''
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0]
  }
  throw new CliError(`${optionName} 只能指定一次。`)
}

export function csv(value: unknown, optionName = '该选项'): string[] | undefined {
  const normalized = textValue(value, optionName)
  if (normalized === undefined) {
    return undefined
  }
  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function booleanValue(
  value: boolean | string | undefined,
  optionName: string,
): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  if (value.toLowerCase() === 'true') {
    return true
  }
  if (value.toLowerCase() === 'false') {
    return false
  }
  throw new CliError(`${optionName} 只能是 true 或 false。`)
}

export function required(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new CliError(`缺少 ${label}。`)
  }
  return normalized
}

export function requiredContent(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new CliError(`缺少 ${label}。`)
  }
  return value
}

export function requireConfirmation(yes: unknown, command: string): void {
  if (yes !== true) {
    throw new CliError(`此操作会修改或删除数据。确认后请重新执行：${command} --yes`)
  }
}

export function slugify(value: string, fallback: string): string {
  return (
    value
      .trim()
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/gu, '-')
      .replace(/[^\p{L}\p{N}\p{M}._~-]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '') || fallback
  )
}
