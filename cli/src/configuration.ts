import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type { CAC, Command } from 'cac'

import { createHaloClient, consolePluginPath, consoleThemePath, extensionPath } from './client.js'
import { CliError } from './errors.js'
import { containsRedactedValue, isJsonObject, mergeJsonObjects, parseJsonObject, parseJsonValue, readJsonObject, setJsonPointer } from './json-input.js'
import { required, requireConfirmation, textValue } from './options.js'
import { isSensitiveKey, redactSecrets } from './secrets.js'
import { printOrExportJson } from './structured-output.js'
import type { StructuredOutputOptions } from './structured-output.js'
import type { ConnectionOptions, Setting, Theme, Plugin } from './types.js'

export interface ConfigurationOptions extends ConnectionOptions, StructuredOutputOptions {
  dryRun?: boolean
  file?: unknown
  group?: unknown
  replace?: boolean
  yes?: boolean
}

export interface ConfigurationField {
  group: string
  pointer: string
  name: string
  label?: string
  type?: string
  required: boolean
  conditional: boolean
  min?: number
  max?: number
  sensitive: boolean
  default?: unknown
  allowCreate?: boolean
  options?: unknown[]
}

export interface ConfigurationTarget {
  label: string
  schema: Setting
  current: Record<string, unknown>
  write: (value: Record<string, unknown>) => Promise<void>
}

const unsafeKeys: Record<string, boolean | undefined> = { ['__proto__']: true, constructor: true, prototype: true }
const objectTypes: Record<string, true | undefined> = { group: true }
const listTypes: Record<string, true | undefined> = { list: true, repeater: true, array: true }
const booleanTypes: Record<string, true | undefined> = { checkbox: true, switch: true, toggle: true }
const textTypes: Record<string, true | undefined> = { text: true, textarea: true, password: true, email: true, url: true, tel: true, color: true, code: true }

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function pointerParts(pointer: string): string[] {
  return pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function requiredRule(value: unknown): boolean {
  if (typeof value === 'string') return value.split('|').some((rule) => rule.split(':')[0]?.trim() === 'required')
  return Array.isArray(value) && value.some((rule) => rule === 'required' || Array.isArray(rule) && rule[0] === 'required')
}

function optionValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => isJsonObject(entry) && Object.hasOwn(entry, 'value') ? entry.value : entry)
      .filter((entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))
  }
  if (isJsonObject(value)) return Object.keys(value)
  return undefined
}

export function configurationForms(schema: Setting): Record<string, unknown>[] {
  if (!schema || !isJsonObject(schema.spec) || !Array.isArray(schema.spec.forms)) {
    throw new CliError('配置 Schema 缺少 spec.forms。')
  }
  return schema.spec.forms.filter(isJsonObject)
}

export function configurationFields(schema: Setting): ConfigurationField[] {
  const fields: ConfigurationField[] = []
  function visit(nodes: unknown, group: string, parent: string, conditional: boolean, sensitive: boolean): void {
    if (Array.isArray(nodes)) {
      nodes.forEach((node) => visit(node, group, parent, conditional, sensitive))
      return
    }
    if (!isJsonObject(nodes)) return
    const type = typeof nodes.$formkit === 'string' ? nodes.$formkit : undefined
    const name = typeof nodes.name === 'string' ? nodes.name : undefined
    const nodeConditional = conditional || nodes.if !== undefined
    let childParent = parent
    let nodeSensitive = sensitive
    if (name && type) {
      if (Object.hasOwn(unsafeKeys, name)) throw new CliError('配置 Schema 包含不安全字段。')
      const pointer = `${parent}/${escapePointer(name)}`
      nodeSensitive = sensitive || type === 'password' || nodes.secret === true || nodes.sensitive === true || isSensitiveKey(name)
      const field: ConfigurationField = {
        group, pointer, name, type,
        label: typeof nodes.label === 'string' ? nodes.label : undefined,
        required: requiredRule(nodes.validation), conditional: nodeConditional, sensitive: nodeSensitive,
      }
      if (Object.hasOwn(nodes, 'value')) field.default = structuredClone(nodes.value)
      const options = optionValues(nodes.options)
      if (typeof nodes.min === 'number') field.min = nodes.min
      if (typeof nodes.max === 'number') field.max = nodes.max
      if (nodes.allowCreate === true) field.allowCreate = true
      if (options?.length) field.options = options
      fields.push(field)
      if (Object.hasOwn(objectTypes, type)) childParent = pointer
      if (Object.hasOwn(listTypes, type)) childParent = `${pointer}/*`
    }
    visit(nodes.children, group, childParent, nodeConditional, nodeSensitive)
    // FormKit conditional branches may wrap inputs in then/else rather than children.
    visit(nodes.then, group, childParent, true, nodeSensitive)
    visit(nodes.else, group, childParent, true, nodeSensitive)
  }
  for (const form of configurationForms(schema)) {
    if (typeof form.group !== 'string' || !form.group || Object.hasOwn(unsafeKeys, form.group)) {
      throw new CliError('配置 Schema 包含无效分组。')
    }
    visit(form.formSchema, form.group, `/${escapePointer(form.group)}`, false, isSensitiveKey(form.group))
  }
  return fields
}

export function configurationDefaults(schema: Setting, group?: string): Record<string, unknown> {
  let defaults: Record<string, unknown> = {}
  for (const form of configurationForms(schema)) {
    if (typeof form.group === 'string' && (!group || form.group === group)) defaults[form.group] = {}
  }
  for (const field of configurationFields(schema)) {
    if ((!group || field.group === group) && Object.hasOwn(field, 'default') && !field.pointer.includes('/*')) {
      defaults = setJsonPointer(defaults, field.pointer, field.default)
    }
  }
  return defaults
}

export function configurationReset(schema: Setting, current: Record<string, unknown>): Record<string, unknown> {
  let proposed = configurationDefaults(schema)
  for (const field of configurationFields(schema)) {
    if (!field.required || field.conditional || Object.hasOwn(field, 'default') || field.pointer.includes('/*')) continue
    const value = valuesAt(current, pointerParts(field.pointer))[0]
    if (value !== undefined) proposed = setJsonPointer(proposed, field.pointer, value)
  }
  return proposed
}

function valuesAt(value: unknown, parts: string[]): unknown[] {
  if (!parts.length) return [value]
  const [first, ...rest] = parts
  if (first === '*') return Array.isArray(value) ? value.flatMap((entry) => valuesAt(entry, rest)) : []
  if (!isJsonObject(value) && !Array.isArray(value)) return [undefined]
  return valuesAt((value as Record<string, unknown>)[first!], rest)
}

function acceptsType(field: ConfigurationField, value: unknown): boolean {
  const type = field.type ?? ''
  if (Object.hasOwn(objectTypes, type)) return isJsonObject(value)
  if (Object.hasOwn(listTypes, type) || type === 'checkbox' && field.options) return Array.isArray(value)
  if (Object.hasOwn(booleanTypes, type)) return typeof value === 'boolean'
  if (type === 'number' || type === 'range') return typeof value === 'number' && Number.isFinite(value)
  if (Object.hasOwn(textTypes, type)) return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)
  return true
}

export function assertConfiguration(value: Record<string, unknown>, schema: Setting): void {
  // Reuse the JSON input guard for unsafe object keys, including deeply nested array values.
  parseJsonObject(JSON.stringify(value), '配置')
  if (containsRedactedValue(value)) throw new CliError('配置包含 [REDACTED]，拒绝写入以免覆盖真实凭据。')
  const effective = mergeJsonObjects(configurationDefaults(schema), value)
  for (const field of configurationFields(schema)) {
    for (const entry of valuesAt(effective, pointerParts(field.pointer))) {
      const missing = entry === undefined || entry === null || entry === '' || Array.isArray(entry) && entry.length === 0
      if (missing) {
        if (field.required && !field.conditional) throw new CliError(`必填配置字段缺失：${field.pointer}`)
        continue
      }
      if (!acceptsType(field, entry)) throw new CliError(`配置字段类型不正确：${field.pointer}（${field.type}）`)
      if (typeof entry === 'number' && (field.min !== undefined && entry < field.min || field.max !== undefined && entry > field.max)) {
        throw new CliError(`配置字段超出 Schema 范围：${field.pointer}`)
      }
      if (field.options && !field.allowCreate) {
        const entries = Array.isArray(entry) ? entry : [entry]
        if (entries.some((item) => !field.options!.some((option) => Object.is(option, item)))) {
          throw new CliError(`配置字段值不在 Schema 选项中：${field.pointer}`)
        }
      }
    }
  }
}

export function assertConfigurationPointer(pointer: string, schema: Setting): void {
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new CliError('无效的 JSON Pointer。')
  const parts = pointerParts(pointer)
  const found = configurationFields(schema).some((field) => {
    const candidate = pointerParts(field.pointer)
    return candidate.length === parts.length && candidate.every((part, index) => part === parts[index] || part === '*' && /^(0|[1-9]\d*|-)$/.test(parts[index]!))
  })
  if (!found) throw new CliError(`Schema 中未发现配置字段：${pointer}`)
}

function maskPointer(value: unknown, parts: string[]): unknown {
  if (!parts.length) return '[REDACTED]'
  const [first, ...rest] = parts
  if (first === '*') return Array.isArray(value) ? value.map((entry) => maskPointer(entry, rest)) : value
  if (!isJsonObject(value) || !Object.hasOwn(value, first!)) return value
  return { ...value, [first!]: maskPointer(value[first!], rest) }
}

export function redactConfiguration(value: unknown, schema: Setting): unknown {
  let result = structuredClone(value)
  for (const field of configurationFields(schema)) {
    if (field.sensitive) result = maskPointer(result, pointerParts(field.pointer))
  }
  return redactSecrets(result)
}

export function redactConfigurationSchema(schema: Setting): Setting {
  function redactNode(node: unknown, inheritedSensitive = false): unknown {
    if (Array.isArray(node)) return node.map((entry) => redactNode(entry, inheritedSensitive))
    if (!isJsonObject(node)) return node
    const sensitive = inheritedSensitive || node.$formkit === 'password' || node.secret === true || node.sensitive === true || typeof node.name === 'string' && isSensitiveKey(node.name)
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [
      key,
      key === 'value' && sensitive ? '[REDACTED]' : redactNode(value, sensitive),
    ]))
  }
  return redactSecrets(redactNode(schema)) as Setting
}

export async function printConfiguration(value: Record<string, unknown>, schema: Setting, options: ConfigurationOptions, label: string): Promise<void> {
  await printOrExportJson(options.includeSecrets ? value : redactConfiguration(value, schema), options, label)
}

export function configurationChanges(before: Record<string, unknown>, after: Record<string, unknown>, schema: Setting): Record<string, unknown>[] {
  const safeBefore = redactConfiguration(before, schema)
  const safeAfter = redactConfiguration(after, schema)
  const changes: Record<string, unknown>[] = []
  function compare(previous: unknown, next: unknown, pointer: string): void {
    if (JSON.stringify(previous) === JSON.stringify(next)) return
    if (isJsonObject(previous) && isJsonObject(next)) {
      const keys = Object.keys({ ...previous, ...next })
      for (const key of keys) compare(previous[key], next[key], `${pointer}/${escapePointer(key)}`)
      return
    }
    const parts = pointerParts(pointer)
    function displayed(document: unknown): unknown {
      let value = document
      for (const part of parts) {
        if (value === '[REDACTED]') return value
        if (!isJsonObject(value) && !Array.isArray(value)) return undefined
        value = (value as Record<string, unknown>)[part]
      }
      return value
    }
    changes.push({ pointer, before: displayed(safeBefore), after: displayed(safeAfter) })
  }
  compare(before, after, '')
  return changes
}

export async function writeConfiguration(target: ConfigurationTarget, updated: Record<string, unknown>, options: ConfigurationOptions): Promise<void> {
  assertConfiguration(updated, target.schema)
  if (!options.dryRun) {
    try { await target.write(updated) }
    catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        throw new CliError(status ? `配置保存失败（HTTP ${status}），请检查字段、权限或并发修改后重试。` : '配置保存失败，请检查网络连接。')
      }
      throw error
    }
  }
  // All writes use the proposed document; Console endpoints return different response shapes.
  const displayed = options.dryRun
    ? { dryRun: true, changes: configurationChanges(target.current, updated, target.schema), configuration: redactConfiguration(updated, target.schema) }
    : redactConfiguration(updated, target.schema)
  await printOrExportJson(displayed, { json: options.json }, target.label)
}

export function addConfigurationConnectionOptions(command: Command): Command {
  return command.option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

export function addConfigurationOutputOptions(command: Command): Command {
  return command.option('--output <file>', '将 JSON 安全写入文件；默认不覆盖')
    .option('--force', '允许替换已有导出文件')
    .option('--include-secrets', '导出未脱敏字段；必须同时指定 --output')
    .option('--json', '输出 JSON')
}

export type ExtensionConfigurationKind = 'theme' | 'plugin'

async function extensionSchema(http: AxiosInstance, kind: ExtensionConfigurationKind, name: string): Promise<Setting> {
  const path = kind === 'theme' ? consoleThemePath : consolePluginPath
  const resource = kind === 'theme'
    ? (await http.get<Theme>(extensionPath('theme.halo.run', 'themes', name))).data
    : (await http.get<Plugin>(extensionPath('plugin.halo.run', 'plugins', name))).data
  required(resource.spec.settingName, `${kind} ${name} 未声明设置 Schema。`)
  required(resource.spec.configMapName, `${kind} ${name} 未声明配置。`)
  return (await http.get<Setting>(path(name, 'setting'))).data
}

export async function loadExtensionConfiguration(http: AxiosInstance, kind: ExtensionConfigurationKind, name: string): Promise<ConfigurationTarget> {
  const schema = await extensionSchema(http, kind, name)
  const path = kind === 'theme' ? consoleThemePath : consolePluginPath
  const current: unknown = (await http.get<Record<string, unknown>>(path(name, 'json-config'))).data ?? {}
  if (!isJsonObject(current)) throw new CliError('当前配置必须是 JSON 对象。')
  return {
    label: kind === 'theme' ? '主题配置' : '插件配置', schema, current,
    write: async (value) => { await http.put(path(name, 'json-config'), value) },
  }
}

export function registerExtensionConfigurationCommands(cli: CAC, kind: ExtensionConfigurationKind, fixedName?: string): void {
  const nameArg = fixedName ? '' : ' <name>'
  const label = kind === 'theme' ? '主题配置' : '插件配置'
  function command(name: string, description: string): Command {
    return addConfigurationConnectionOptions(cli.command(name, description))
  }
  function action(handler: (name: string, args: unknown[], options: ConfigurationOptions) => Promise<void>): (...args: unknown[]) => Promise<void> {
    return async (...args) => {
      const options = args.pop() as ConfigurationOptions
      const name = fixedName ?? args.shift() as string
      await handler(name, args, options)
    }
  }
  for (const schemaCommand of ['setting', 'schema', 'config-fields']) {
    addConfigurationOutputOptions(command(`${schemaCommand}${nameArg}`, `发现${label} Schema 和字段`))
      .action(action(async (name, _args, options) => {
        const { http } = await createHaloClient(options)
        const schema = await extensionSchema(http, kind, name)
        const safeSchema = options.includeSecrets ? schema : redactConfigurationSchema(schema)
        const value = schemaCommand === 'config-fields' ? configurationFields(safeSchema) : safeSchema
        await printOrExportJson(value, options, `${label} Schema`)
      }))
  }
  for (const readCommand of ['config', 'config-export']) {
    addConfigurationOutputOptions(command(`${readCommand}${nameArg}`, `读取或导出${label}`))
      .action(action(async (name, _args, options) => {
        if (readCommand === 'config-export') required(textValue(options.output, '--output'), '--output')
        const { http } = await createHaloClient(options)
        const target = await loadExtensionConfiguration(http, kind, name)
        await printConfiguration(target.current, target.schema, options, target.label)
      }))
  }
  command(`config-set${nameArg} <pointer> <value>`, `按 JSON Pointer 修改${label}`)
    .option('--dry-run', '校验并显示脱敏结果，不写入')
    .option('--json', '输出 JSON')
    .action(action(async (name, args, options) => {
      const { http } = await createHaloClient(options)
      const target = await loadExtensionConfiguration(http, kind, name)
      const pointer = args[0] as string
      assertConfigurationPointer(pointer, target.schema)
      await writeConfiguration(target, setJsonPointer(target.current, pointer, parseJsonValue(args[1] as string)), options)
    }))
  command(`config-import${nameArg}`, `从 JSON 文件合并或替换${label}`)
    .option('--file <path>', '配置 JSON 文件')
    .option('--replace', '替换完整配置，默认递归合并')
    .option('--yes', '确认完整替换')
    .option('--dry-run', '校验并显示脱敏结果，不写入')
    .option('--json', '输出 JSON')
    .action(action(async (name, _args, options) => {
      const imported = await readJsonObject(required(textValue(options.file, '--file'), '--file'), '配置文件')
      if (containsRedactedValue(imported)) throw new CliError('配置包含 [REDACTED]，拒绝写入以免覆盖真实凭据。')
      if (options.replace && !options.dryRun) requireConfirmation(options.yes, `${kind} config-import --replace`)
      const { http } = await createHaloClient(options)
      const target = await loadExtensionConfiguration(http, kind, name)
      await writeConfiguration(target, options.replace ? imported : mergeJsonObjects(target.current, imported), options)
    }))
  command(`config-reset${nameArg}`, `恢复${label} Schema 默认值`)
    .option('--yes', '确认重置')
    .option('--dry-run', '预览默认值，不写入')
    .option('--json', '输出 JSON')
    .action(action(async (name, _args, options) => {
      if (!options.dryRun) requireConfirmation(options.yes, `${kind} config-reset`)
      const { http } = await createHaloClient(options)
      const target = await loadExtensionConfiguration(http, kind, name)
      await writeConfiguration(target, configurationReset(target.schema, target.current), options)
    }))
}
