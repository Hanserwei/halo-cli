import { readFile } from 'node:fs/promises'

import { CliError } from './errors.js'

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new CliError(`${label} 不是有效的 JSON${detail}`)
  }
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = parseJson(value, label)
  if (!isJsonObject(parsed)) throw new CliError(`${label} 必须是 JSON 对象。`)
  assertSafeValue(parsed, label)
  return parsed
}

export function parseStringRecord(value: string, label: string): Record<string, string> {
  const parsed = parseJsonObject(value, label)
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== 'string') {
      throw new CliError(`${label} 的字段 ${key} 必须是字符串。`)
    }
  }
  return parsed as Record<string, string>
}

export function parseJsonArray(value: string, label: string): unknown[] {
  const parsed = parseJson(value, label)
  if (!Array.isArray(parsed)) throw new CliError(`${label} 必须是 JSON 数组。`)
  return parsed
}

export async function readJson(path: string, label: string): Promise<unknown> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new CliError(`无法读取${label} ${path}${detail}`)
  }
  return parseJson(source, `${label} ${path}`)
}

export async function readJsonObject(
  path: string,
  label: string,
): Promise<Record<string, unknown>> {
  const parsed = await readJson(path, label)
  if (!isJsonObject(parsed)) throw new CliError(`${label}必须包含 JSON 对象。`)
  assertSafeValue(parsed, label)
  return parsed
}

export function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeJsonObjects(
  base: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(update)) {
    assertSafeKey(key, 'JSON 对象')
    const current = result[key]
    result[key] =
      isJsonObject(current) && isJsonObject(value)
        ? mergeJsonObjects(current, value)
        : structuredClone(value)
  }
  return result
}

export function setJsonPointer(
  document: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> {
  if (!pointer.startsWith('/') || pointer === '/') {
    throw new CliError('JSON Pointer 必须以 / 开头并指向具体字段，例如 /top/above/enable_above。')
  }
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  segments.forEach((segment) => assertSafeKey(segment, 'JSON Pointer'))

  const result = structuredClone(document)
  let current: Record<string, unknown> | unknown[] = result
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!
    const nextSegment = segments[index + 1]!
    if (Array.isArray(current)) {
      const arrayIndex = parseArrayIndex(segment, current.length, true)
      if (arrayIndex === current.length) {
        current.push(looksLikeArrayIndex(nextSegment) ? [] : {})
      }
      const next = current[arrayIndex]
      if (!isJsonObject(next) && !Array.isArray(next)) {
        current[arrayIndex] = looksLikeArrayIndex(nextSegment) ? [] : {}
      }
      current = current[arrayIndex] as Record<string, unknown> | unknown[]
      continue
    }

    const next = current[segment]
    if (!isJsonObject(next) && !Array.isArray(next)) {
      current[segment] = looksLikeArrayIndex(nextSegment) ? [] : {}
    }
    current = current[segment] as Record<string, unknown> | unknown[]
  }

  const finalSegment = segments.at(-1)!
  if (Array.isArray(current)) {
    if (finalSegment === '-') current.push(structuredClone(value))
    else current[parseArrayIndex(finalSegment, current.length, true)] = structuredClone(value)
  } else {
    current[finalSegment] = structuredClone(value)
  }
  return result
}

export function containsRedactedValue(value: unknown): boolean {
  if (value === '[REDACTED]') return true
  if (Array.isArray(value)) return value.some(containsRedactedValue)
  if (isJsonObject(value)) return Object.values(value).some(containsRedactedValue)
  return false
}

function assertSafeValue(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeValue(item, label))
    return
  }
  if (isJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertSafeKey(key, label)
      assertSafeValue(child, label)
    }
  }
}

function assertSafeKey(key: string, label: string): void {
  if (unsafeKeys.has(key)) throw new CliError(`${label} 包含不安全字段：${key}`)
}

function looksLikeArrayIndex(value: string): boolean {
  return value === '-' || /^(0|[1-9]\d*)$/.test(value)
}

function parseArrayIndex(value: string, length: number, allowAppend: boolean): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new CliError(`数组 JSON Pointer 下标无效：${value}`)
  }
  const index = Number(value)
  if (index > length || (!allowAppend && index >= length)) {
    throw new CliError(`数组 JSON Pointer 下标越界：${value}`)
  }
  return index
}
