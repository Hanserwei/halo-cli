import { readFile } from 'node:fs/promises'

import type { CAC, Command } from 'cac'
import Table from 'cli-table3'

import { createHaloClient } from '../client.js'
import { CliError } from '../errors.js'
import { isJsonObject, readJsonObject } from '../json-input.js'
import { positiveInteger, requireConfirmation, textValue } from '../options.js'
import { printJson } from '../output.js'
import { printOrExportJson } from '../structured-output.js'
import type { StructuredOutputOptions } from '../structured-output.js'
import type { ConnectionOptions, Metadata, Page } from '../types.js'

const basePath = '/apis/console.api.mail-template.halo.run/v1alpha1'
const templateFields = ['title', 'htmlBody', 'rawBody', 'language'] as const

type TemplateField = (typeof templateFields)[number]
type TemplateUpdate = Partial<Record<TemplateField, string>>

interface MailTemplateDetail {
  customized: boolean
  reasonType: {
    metadata: Metadata
    spec: { displayName?: string; description?: string; properties?: unknown[] }
  }
  template: {
    apiVersion: string
    kind: string
    metadata: Metadata
    spec: {
      reasonSelector: { reasonType: string; language: string }
      template: { title: string; htmlBody?: string; rawBody?: string }
    }
  } | null
}

interface MailTemplateOptions extends ConnectionOptions, StructuredOutputOptions {
  file?: unknown
  htmlFile?: unknown
  language?: unknown
  page?: string | number
  rawFile?: unknown
  size?: string | number
  title?: unknown
  yes?: boolean
}

function addConnectionOptions(command: Command) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时访问凭据（需同时提供 --url）')
}

function addOutputOptions(command: Command) {
  return command
    .option('--output <file>', '将 JSON 写入文件；默认不覆盖已有文件')
    .option('--force', '允许替换已有导出文件')
    .option('--json', '输出 JSON')
}

function templatePath(name?: string, action?: string): string {
  let path = `${basePath}/mailtemplates`
  if (name !== undefined) {
    if (!name.trim() || /[\s/\\?#\u0000-\u001f\u007f]/u.test(name) || name === '.' || name === '..') {
      throw new CliError('模板名称必须是 ReasonType 的 metadata.name，不能包含空白或路径字符。')
    }
    path += `/${encodeURIComponent(name)}`
  }
  return action ? `${path}/${action}` : path
}

async function readBodyFile(value: unknown, label: string): Promise<string | undefined> {
  const path = textValue(value, label)
  if (path === undefined) return undefined
  if (!path.trim()) throw new CliError(`${label} 需要文件路径。`)
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new CliError(`无法读取 ${label} 文件 ${path}${detail}`)
  }
}

function importedUpdate(source: Record<string, unknown>): TemplateUpdate {
  // get/export 输出保留完整模型；导入时只提取可编辑的模板字段。
  const resource = isJsonObject(source.template) && isJsonObject(source.template.spec)
    ? source.template
    : source
  const spec = isJsonObject(resource.spec) ? resource.spec : undefined
  const nested = spec && isJsonObject(spec.template) ? spec.template : undefined
  let fields: Record<string, unknown> = source
  if (nested) {
    const selector = isJsonObject(spec?.reasonSelector) ? spec.reasonSelector : undefined
    fields = { ...nested }
    if (selector?.language !== undefined) fields.language = selector.language
  }
  for (const key of Object.keys(fields)) {
    if (!templateFields.includes(key as TemplateField)) {
      throw new CliError(`模板 JSON 包含不支持的字段：${key}。允许的字段：${templateFields.join(', ')}。`)
    }
    if (typeof fields[key] !== 'string') throw new CliError(`模板字段 ${key} 必须是字符串。`)
  }
  return fields as TemplateUpdate
}

async function readUpdate(options: MailTemplateOptions, allowEmpty = false): Promise<TemplateUpdate> {
  const file = textValue(options.file, '--file')
  if (file !== undefined && !file.trim()) throw new CliError('--file 需要文件路径。')
  const input: TemplateUpdate = file === undefined
    ? {}
    : importedUpdate(await readJsonObject(file, '邮件模板'))
  const title = textValue(options.title, '--title')
  const language = textValue(options.language, '--language')
  const [htmlBody, rawBody] = await Promise.all([
    readBodyFile(options.htmlFile, '--html-file'),
    readBodyFile(options.rawFile, '--raw-file'),
  ])
  if (title !== undefined) input.title = title
  if (language !== undefined) input.language = language
  if (htmlBody !== undefined) input.htmlBody = htmlBody
  if (rawBody !== undefined) input.rawBody = rawBody
  if (input.title !== undefined && !input.title.trim()) throw new CliError('邮件标题不能为空。')
  if (input.language !== undefined && !input.language.trim()) {
    throw new CliError('模板语言不能为空，例如 default、zh-CN 或 x-private。')
  }
  if (!allowEmpty && !Object.keys(input).length) {
    throw new CliError('请至少提供 --title、--html-file、--raw-file、--language 或 --file 中的一项。')
  }
  return input
}

function printTemplateList(page: Page<MailTemplateDetail>, json?: boolean): void {
  if (json) return printJson(page)
  const table = new Table({ head: ['NAME', 'DISPLAY NAME', 'SOURCE', 'TITLE'] })
  table.push(...page.items.map((item) => [
    item.reasonType.metadata.name,
    item.reasonType.spec.displayName ?? '-',
    item.customized ? '自定义' : '默认',
    item.template?.spec.template.title ?? '-',
  ]))
  process.stdout.write(`${table.toString()}\n第 ${page.page} 页，共 ${page.total} 个邮件模板\n`)
}

export function registerMailTemplateCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '分页查询邮件模板及自定义状态'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量（最多 100）', { default: 20 })
    .option('--json', '输出 JSON')
    .action(async (options: MailTemplateOptions) => {
      const size = positiveInteger(options.size, 20)
      if (size > 100) throw new CliError('--size 不能大于 100。')
      const page = positiveInteger(options.page, 1)
      const { http } = await createHaloClient(options)
      const response = await http.get<Page<MailTemplateDetail>>(templatePath(), { params: { page, size } })
      printTemplateList(response.data, options.json)
    })

  for (const command of ['get', 'export'] as const) {
    addOutputOptions(addConnectionOptions(cli.command(`${command} <name>`, command === 'get' ? '查看模板、通知原因和可用变量' : '导出邮件模板，供版本控制和后续导入')))
      .action(async (name: string, options: MailTemplateOptions) => {
        const path = templatePath(name)
        const { http } = await createHaloClient(options)
        const response = await http.get<MailTemplateDetail>(path)
        await printOrExportJson(response.data, { ...options, redact: false }, '邮件模板')
      })
  }

  for (const command of ['update', 'import'] as const) {
    addOutputOptions(addConnectionOptions(cli.command(`${command} <name>`, command === 'update' ? '部分更新模板；首次修改基于默认模板创建' : '从 JSON 文件导入模板内容，保留未传入字段')))
      .option('--file <file>', '从 JSON 文件读取模板字段；也可导入 get 的导出文件')
      .option('--title <title>', '邮件标题')
      .option('--html-file <file>', '从 UTF-8 文件读取 HTML 正文，可为空文件')
      .option('--raw-file <file>', '从 UTF-8 文件读取纯文本正文，可为空文件')
      .option('--language <language>', '模板语言，如 default；省略则保留原值')
      .action(async (name: string, options: MailTemplateOptions) => {
        const path = templatePath(name)
        if (command === 'import' && options.file === undefined) throw new CliError('import 需要 --file。')
        const input = await readUpdate(options)
        const { http } = await createHaloClient(options)
        const response = await http.put<MailTemplateDetail>(path, input)
        await printOrExportJson(response.data, { ...options, redact: false }, '邮件模板')
      })
  }

  addConnectionOptions(cli.command('validate <name>', '校验当前模板或未保存的修改，不发送邮件'))
    .option('--file <file>', '从 JSON 文件读取待校验的模板字段')
    .option('--title <title>', '待校验的邮件标题')
    .option('--html-file <file>', '待校验的 HTML 正文文件')
    .option('--raw-file <file>', '待校验的纯文本正文文件')
    .option('--language <language>', '模板语言，如 default')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MailTemplateOptions) => {
      const path = templatePath(name, 'validate')
      const input = await readUpdate(options, true)
      const { http } = await createHaloClient(options)
      const response = await http.post<{ valid: boolean }>(path, input)
      if (options.json) printJson(response.data)
      else process.stdout.write('邮件模板校验通过。\n')
    })

  addConnectionOptions(cli.command('restore <name>', '删除自定义模板，恢复默认模板'))
    .option('--yes', '确认恢复默认模板')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MailTemplateOptions) => {
      const path = templatePath(name)
      requireConfirmation(options.yes, `halo-cli mail-template restore ${name}`)
      const { http } = await createHaloClient(options)
      await http.delete(path)
      if (options.json) printJson({ name, restored: true })
      else process.stdout.write(`邮件模板 ${name} 已恢复默认设置。\n`)
    })

  addConnectionOptions(cli.command('verify <name>', '向当前凭据所属用户的邮箱发送模板验证邮件'))
    .option('--yes', '确认发送验证邮件')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MailTemplateOptions) => {
      const path = templatePath(name, 'verify-send')
      requireConfirmation(options.yes, `halo-cli mail-template verify ${name}`)
      const { http } = await createHaloClient(options)
      await http.post(path)
      if (options.json) printJson({ name, submitted: true })
      else process.stdout.write('验证邮件已提交，请检查当前用户的邮箱。\n')
    })

  addOutputOptions(addConnectionOptions(cli.command('properties', '查询模板可使用的系统变量')))
    .action(async (options: MailTemplateOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get(`${basePath}/system-properties`)
      await printOrExportJson(response.data, { ...options, redact: false }, '模板系统变量')
    })
}
