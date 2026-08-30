import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'

import type { Method } from 'axios'
import type { CAC } from 'cac'

import { createHaloClient } from '../client.js'
import { CliError } from '../errors.js'
import {
  isJsonObject,
  parseJson,
  parseJsonObject,
  readJson,
} from '../json-input.js'
import { requireConfirmation, textValue } from '../options.js'
import { printOrExportJson, type StructuredOutputOptions } from '../structured-output.js'
import type { ConnectionOptions } from '../types.js'

interface ApiOptions extends ConnectionOptions, StructuredOutputOptions {
  body?: unknown
  field?: unknown
  file?: unknown
  filename?: unknown
  form?: unknown
  query?: unknown
  yes?: boolean
}

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

function addOutputOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--output <file>', '将响应 JSON 写入文件')
    .option('--force', '允许替换已有导出文件')
    .option('--include-secrets', '导出未脱敏字段；必须同时指定 --output')
    .option('--json', '输出 JSON')
}

export function normalizeApiPath(value: string): string {
  if (value.includes('\\') || (!value.startsWith('/apis/') && !value.startsWith('/api/'))) {
    throw new CliError('API 路径必须是当前 Halo 站点内以 /apis/ 或 /api/ 开头的绝对路径。')
  }
  const parsed = new URL(value, 'http://halo-cli.local')
  if (parsed.origin !== 'http://halo-cli.local') {
    throw new CliError('API 命令不接受外部 URL，只能访问当前 Halo 站点。')
  }
  return `${parsed.pathname}${parsed.search}`
}

function normalizeMethod(value: string): Method {
  const method = value.toUpperCase()
  if (!methods.has(method)) {
    throw new CliError(`不支持的 API 方法：${value}。可用值为 GET、POST、PUT、PATCH、DELETE。`)
  }
  return method as Method
}

async function requestBody(options: ApiOptions): Promise<unknown> {
  const inline = textValue(options.body, '--body')
  const file = textValue(options.file, '--file')
  if (inline && file) throw new CliError('--body 与 --file 不能同时使用。')
  if (inline) return parseJson(inline, '--body')
  if (file) return readJson(file, '请求体文件')
  return undefined
}

function queryParameters(value: unknown): Record<string, unknown> | undefined {
  const inline = textValue(value, '--query')
  return inline ? parseJsonObject(inline, '--query') : undefined
}

async function printApiResponse(
  data: unknown,
  status: number,
  options: ApiOptions,
): Promise<void> {
  const value = data === undefined || data === '' ? { status } : data
  await printOrExportJson(value, options, 'API 响应')
}

export function registerApiCommands(cli: CAC): void {
  addOutputOptions(
    addConnectionOptions(cli.command('request <method> <path>', '调用当前 Halo 站点的 JSON API')),
  )
    .option('--query <json>', '查询参数 JSON 对象')
    .option('--body <json>', '请求体 JSON')
    .option('--file <path>', '从文件读取请求体 JSON')
    .option('--yes', '确认 DELETE 请求')
    .action(async (methodValue: string, pathValue: string, options: ApiOptions) => {
      const method = normalizeMethod(methodValue)
      const path = normalizeApiPath(pathValue)
      if (method === 'DELETE') {
        requireConfirmation(options.yes, `halo-cli api request DELETE ${path}`)
      }
      const { http } = await createHaloClient(options)
      const response = await http.request({
        data: await requestBody(options),
        method,
        params: queryParameters(options.query),
        url: path,
      })
      await printApiResponse(response.data, response.status, options)
    })

  addOutputOptions(
    addConnectionOptions(cli.command('upload <path>', '向当前 Halo 站点的 multipart API 上传文件')),
  )
    .option('--file <path>', '本地文件路径')
    .option('--field <name>', '文件字段名', { default: 'file' })
    .option('--filename <name>', '覆盖上传文件名')
    .option('--form <json>', '其他 multipart 字段的 JSON 对象')
    .option('--query <json>', '查询参数 JSON 对象')
    .action(async (pathValue: string, options: ApiOptions) => {
      const path = normalizeApiPath(pathValue)
      const file = textValue(options.file, '--file')
      if (!file) throw new CliError('api upload 必须指定 --file <path>。')
      const field = textValue(options.field, '--field')?.trim() || 'file'
      if (!/^[A-Za-z0-9_.-]+$/.test(field)) throw new CliError(`multipart 字段名无效：${field}`)

      const formData = new FormData()
      const filename = textValue(options.filename, '--filename')?.trim() || basename(file)
      formData.append(field, await openAsBlob(file), filename)
      const fields = options.form
        ? parseJsonObject(textValue(options.form, '--form')!, '--form')
        : undefined
      for (const [key, value] of Object.entries(fields ?? {})) {
        if (value === undefined) continue
        formData.append(key, isJsonObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value))
      }

      const { http } = await createHaloClient(options)
      const response = await http.post(path, formData, {
        params: queryParameters(options.query),
      })
      await printApiResponse(response.data, response.status, options)
    })
}
