import type { CAC } from 'cac'

import {
  createHaloClient,
  customExtensionPath,
  waitForDeletion,
} from '../client.js'
import { CliError } from '../errors.js'
import {
  isJsonObject,
  mergeJsonObjects,
  parseJsonArray,
  parseJsonObject,
  parseStringRecord,
  parseJsonValue,
  readJson,
  readJsonObject,
  setJsonPointer,
} from '../json-input.js'
import { csv, positiveInteger, required, requireConfirmation, textValue } from '../options.js'
import { printExtension, printExtensionList, printJson } from '../output.js'
import type {
  ConnectionOptions,
  HaloExtension,
  Page,
} from '../types.js'

interface ResourceDescriptor {
  alias: string
  generateName: string
  group: string
  kind: string
  resource: string
  version: string
}

interface ExtensionOptions extends ConnectionOptions {
  annotations?: unknown
  fieldSelector?: unknown
  file?: unknown
  generateName?: unknown
  json?: boolean
  kind?: unknown
  labelSelector?: unknown
  labels?: unknown
  name?: unknown
  page?: string
  patch?: unknown
  pointer?: unknown
  size?: string
  sort?: unknown
  spec?: unknown
  value?: unknown
  yes?: boolean
}

const descriptors: ResourceDescriptor[] = [
  {
    alias: 'link-group',
    generateName: 'link-group-',
    group: 'core.halo.run',
    kind: 'LinkGroup',
    resource: 'linkgroups',
    version: 'v1alpha1',
  },
  {
    alias: 'link',
    generateName: 'link-',
    group: 'core.halo.run',
    kind: 'Link',
    resource: 'links',
    version: 'v1alpha1',
  },
  {
    alias: 'link-application',
    generateName: 'link-application-',
    group: 'core.halo.run',
    kind: 'LinkApplication',
    resource: 'linkapplications',
    version: 'v1alpha1',
  },
  {
    alias: 'moment',
    generateName: 'moment-',
    group: 'moment.halo.run',
    kind: 'Moment',
    resource: 'moments',
    version: 'v1alpha1',
  },
  {
    alias: 'photo-group',
    generateName: 'photo-group-',
    group: 'core.halo.run',
    kind: 'PhotoGroup',
    resource: 'photogroups',
    version: 'v1alpha1',
  },
  {
    alias: 'photo',
    generateName: 'photo-',
    group: 'core.halo.run',
    kind: 'Photo',
    resource: 'photos',
    version: 'v1alpha1',
  },
  {
    alias: 'bangumi',
    generateName: 'ban-',
    group: 'bangumi.roozen.top',
    kind: 'Bangumi',
    resource: 'bangumis',
    version: 'v1alpha1',
  },
  {
    alias: 'equipment-group',
    generateName: 'equipment-group-',
    group: 'equipment.kunkunyu.com',
    kind: 'EquipmentGroup',
    resource: 'equipmentgroups',
    version: 'v1alpha1',
  },
  {
    alias: 'equipment',
    generateName: 'equipment-',
    group: 'equipment.kunkunyu.com',
    kind: 'Equipment',
    resource: 'equipments',
    version: 'v1alpha1',
  },
]

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

function addResourceInputOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--spec <json>', '资源 spec JSON 对象')
    .option('--file <path>', '完整资源 JSON 文件')
    .option('--name <name>', '指定 metadata.name')
    .option('--generate-name <prefix>', '指定 metadata.generateName 前缀')
    .option('--annotations <json>', 'metadata.annotations JSON 对象')
    .option('--labels <json>', 'metadata.labels JSON 对象')
    .option('--kind <kind>', '自定义资源的 Kind；使用内置别名时可省略')
}

function resolveDescriptor(value: string, kindValue?: unknown): ResourceDescriptor {
  const preset = descriptors.find((descriptor) => descriptor.alias === value)
  if (preset) return preset

  const parts = value.split('/')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new CliError(
      `未知资源 ${value}。请使用 halo-cli extension presets 中的别名，或 group/version/resource。`,
    )
  }
  const kind = textValue(kindValue, '--kind')?.trim() || ''
  return {
    alias: value,
    generateName: `${parts[2]!.replace(/s$/, '')}-`,
    group: parts[0]!,
    kind,
    resource: parts[2]!,
    version: parts[1]!,
  }
}

function descriptorPath(descriptor: ResourceDescriptor, name?: string): string {
  return customExtensionPath(
    descriptor.group,
    descriptor.version,
    descriptor.resource,
    name,
  )
}

function optionalObject(value: unknown, option: string): Record<string, unknown> | undefined {
  const text = textValue(value, option)
  return text === undefined ? undefined : parseJsonObject(text, option)
}

function optionalStringRecord(value: unknown, option: string): Record<string, string> | undefined {
  const text = textValue(value, option)
  return text === undefined ? undefined : parseStringRecord(text, option)
}

async function buildCreatePayload(
  descriptor: ResourceDescriptor,
  options: ExtensionOptions,
): Promise<HaloExtension> {
  const file = textValue(options.file, '--file')
  if (file && options.spec !== undefined) {
    throw new CliError('--file 与 --spec 不能同时使用。')
  }

  if (file) {
    const payload = await readJsonObject(file, '资源文件')
    validateExtension(payload, descriptor, true)
    return payload as unknown as HaloExtension
  }

  const specText = required(textValue(options.spec, '--spec'), '资源 spec（--spec）')
  const kind = descriptor.kind || required(textValue(options.kind, '--kind'), '资源 Kind（--kind）')
  const name = textValue(options.name, '--name')?.trim()
  const generateName = textValue(options.generateName, '--generate-name')?.trim()
  return {
    apiVersion: `${descriptor.group}/${descriptor.version}`,
    kind,
    metadata: {
      annotations: optionalStringRecord(options.annotations, '--annotations'),
      generateName: name ? undefined : generateName || descriptor.generateName,
      labels: optionalStringRecord(options.labels, '--labels'),
      name: name || '',
    },
    spec: parseJsonObject(specText, '--spec'),
  }
}

function validateExtension(
  payload: Record<string, unknown>,
  descriptor: ResourceDescriptor,
  requireKind: boolean,
): void {
  if (!isJsonObject(payload.metadata)) throw new CliError('资源 JSON 缺少 metadata 对象。')
  if (!payload.apiVersion) payload.apiVersion = `${descriptor.group}/${descriptor.version}`
  if (requireKind && !payload.kind && !descriptor.kind) {
    throw new CliError('资源 JSON 缺少 kind，且未指定 --kind。')
  }
  if (!payload.kind && descriptor.kind) payload.kind = descriptor.kind
}

async function buildUpdatePayload(
  current: HaloExtension,
  descriptor: ResourceDescriptor,
  options: ExtensionOptions,
): Promise<HaloExtension> {
  const file = textValue(options.file, '--file')
  const spec = optionalObject(options.spec, '--spec')
  const annotations = optionalStringRecord(options.annotations, '--annotations')
  const labels = optionalStringRecord(options.labels, '--labels')
  if (file && (spec || annotations || labels)) {
    throw new CliError('--file 不能与 --spec、--annotations 或 --labels 同时使用。')
  }

  if (file) {
    const payload = await readJsonObject(file, '资源文件')
    validateExtension(payload, descriptor, true)
    const metadata = payload.metadata as Record<string, unknown>
    metadata.name = current.metadata.name
    return payload as unknown as HaloExtension
  }
  if (!spec && !annotations && !labels) {
    throw new CliError('更新资源至少需要 --spec、--annotations、--labels 或 --file。')
  }

  return {
    ...current,
    metadata: {
      ...current.metadata,
      annotations: annotations
        ? (mergeJsonObjects(current.metadata.annotations ?? {}, annotations) as Record<string, string>)
        : current.metadata.annotations,
      labels: labels
        ? (mergeJsonObjects(current.metadata.labels ?? {}, labels) as Record<string, string>)
        : current.metadata.labels,
    },
    spec: spec ? mergeJsonObjects(current.spec ?? {}, spec) : current.spec,
  }
}

export function registerExtensionCommands(cli: CAC): void {
  cli.command('presets', '列出 Hao 和常用插件的内置资源别名')
    .option('--json', '输出 JSON')
    .action((options: ExtensionOptions) => {
      if (options.json) {
        printJson(descriptors)
        return
      }
      for (const descriptor of descriptors) {
        process.stdout.write(
          `${descriptor.alias.padEnd(18)} ${descriptor.group}/${descriptor.version}/${descriptor.resource} (${descriptor.kind})\n`,
        )
      }
    })

  addConnectionOptions(cli.command('list <resource>', '列出 Extension 资源'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--label-selector <selectors>', '标签选择器，多个值用逗号分隔')
    .option('--field-selector <selectors>', '字段选择器，多个值用逗号分隔')
    .option('--sort <sort>', '排序，多个值用逗号分隔')
    .option('--json', '输出 JSON')
    .action(async (resource: string, options: ExtensionOptions) => {
      const descriptor = resolveDescriptor(resource, options.kind)
      const { http } = await createHaloClient(options)
      const response = await http.get<Page<HaloExtension>>(descriptorPath(descriptor), {
        params: {
          fieldSelector: csv(options.fieldSelector, '--field-selector'),
          labelSelector: csv(options.labelSelector, '--label-selector'),
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 50),
          sort: csv(options.sort, '--sort'),
        },
      })
      printExtensionList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <resource> <name>', '查看 Extension 资源'))
    .option('--json', '输出 JSON')
    .action(async (resource: string, name: string, options: ExtensionOptions) => {
      const descriptor = resolveDescriptor(resource, options.kind)
      const { http } = await createHaloClient(options)
      const response = await http.get<HaloExtension>(descriptorPath(descriptor, name))
      printExtension(response.data, options.json)
    })

  addResourceInputOptions(addConnectionOptions(cli.command('create <resource>', '创建 Extension 资源')))
    .option('--json', '输出 JSON')
    .action(async (resource: string, options: ExtensionOptions) => {
      const descriptor = resolveDescriptor(resource, options.kind)
      const payload = await buildCreatePayload(descriptor, options)
      const { http } = await createHaloClient(options)
      const response = await http.post<HaloExtension>(descriptorPath(descriptor), payload)
      if (options.json) printJson(response.data)
      else process.stdout.write(`已创建 ${descriptor.alias} ${response.data.metadata.name}。\n`)
    })

  addResourceInputOptions(
    addConnectionOptions(cli.command('update <resource> <name>', '合并更新 Extension 资源')),
  )
    .option('--json', '输出 JSON')
    .action(async (resource: string, name: string, options: ExtensionOptions) => {
      const descriptor = resolveDescriptor(resource, options.kind)
      const path = descriptorPath(descriptor, name)
      const { http } = await createHaloClient(options)
      const current = (await http.get<HaloExtension>(path)).data
      const payload = await buildUpdatePayload(current, descriptor, options)
      const response = await http.put<HaloExtension>(path, payload)
      if (options.json) printJson(response.data)
      else process.stdout.write(`已更新 ${descriptor.alias} ${name}。\n`)
    })

  addConnectionOptions(cli.command('set <resource> <name> <pointer> <value>', '按 JSON Pointer 更新一个字段'))
    .option('--json', '输出 JSON')
    .action(
      async (
        resource: string,
        name: string,
        pointer: string,
        value: string,
        options: ExtensionOptions,
      ) => {
        const descriptor = resolveDescriptor(resource, options.kind)
        const path = descriptorPath(descriptor, name)
        const { http } = await createHaloClient(options)
        const current = (await http.get<HaloExtension>(path)).data
        const payload = setJsonPointer(current, pointer, parseJsonValue(value)) as HaloExtension
        const response = await http.put<HaloExtension>(path, payload)
        if (options.json) printJson(response.data)
        else process.stdout.write(`已更新 ${descriptor.alias} ${name} 的 ${pointer}。\n`)
      },
    )

  addConnectionOptions(cli.command('patch <resource> <name>', '应用 JSON Patch'))
    .option('--patch <json>', 'JSON Patch 数组')
    .option('--file <path>', 'JSON Patch 文件')
    .option('--json', '输出 JSON')
    .action(async (resource: string, name: string, options: ExtensionOptions) => {
      const descriptor = resolveDescriptor(resource, options.kind)
      const inline = textValue(options.patch, '--patch')
      const file = textValue(options.file, '--file')
      if (Boolean(inline) === Boolean(file)) {
        throw new CliError('必须且只能指定 --patch 或 --file。')
      }
      const patch = inline ? parseJsonArray(inline, '--patch') : await readJson(file!, 'Patch 文件')
      if (!Array.isArray(patch)) throw new CliError('Patch 文件必须包含 JSON 数组。')
      const { http } = await createHaloClient(options)
      const response = await http.patch<HaloExtension>(descriptorPath(descriptor, name), patch, {
        headers: { 'Content-Type': 'application/json-patch+json' },
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`已 Patch ${descriptor.alias} ${name}。\n`)
    })

  addConnectionOptions(cli.command('delete <resource> <name>', '删除 Extension 资源'))
    .option('--yes', '确认删除')
    .option('--json', '输出 JSON')
    .action(async (resource: string, name: string, options: ExtensionOptions) => {
      requireConfirmation(options.yes, `halo-cli extension delete ${resource} ${name}`)
      const descriptor = resolveDescriptor(resource, options.kind)
      const path = descriptorPath(descriptor, name)
      const { http } = await createHaloClient(options)
      await http.delete(path)
      await waitForDeletion(http, path)
      if (options.json) printJson({ deleted: true, name, resource: descriptor.alias })
      else process.stdout.write(`已删除 ${descriptor.alias} ${name}。\n`)
    })
}
