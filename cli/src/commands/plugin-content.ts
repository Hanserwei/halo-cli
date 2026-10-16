import { openAsBlob } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import type { CAC, Command } from 'cac'
import MarkdownIt from 'markdown-it'

import { createHaloClient, customExtensionPath, waitForDeletion } from '../client.js'
import { addConfigurationConnectionOptions } from '../configuration.js'
import { CliError } from '../errors.js'
import { isJsonObject, mergeJsonObjects, parseJsonObject, readJsonObject } from '../json-input.js'
import { booleanValue, csv, integer, positiveInteger, required, requireConfirmation, textValue } from '../options.js'
import { printJson } from '../output.js'
import type { ConnectionOptions, HaloExtension } from '../types.js'

interface ResourceContract {
  apiVersion: string
  kind: string
  resource: string
  label: string
  requiredFields: string[]
  listPath?: string
  createPath?: string
  deletePath?: string
}

interface ContentOptions extends ConnectionOptions {
  file?: unknown
  spec?: unknown
  name?: string
  displayName?: string
  description?: string
  resourceUrl?: string
  owner?: string
  group?: string
  priority?: string
  content?: string
  visible?: string
  tags?: unknown
  page?: string
  size?: string
  keyword?: string
  names?: unknown
  withAttachment?: boolean | string
  deletePhotos?: boolean | string
  json?: boolean
  yes?: boolean
  dryRun?: boolean
}

const equipment: ResourceContract = {
  apiVersion: 'equipment.hanserwei.github.io/v1alpha1', kind: 'Equipment', resource: 'equipments',
  label: '装备', requiredFields: ['displayName', 'groupName'],
}
const equipmentGroup: ResourceContract = {
  apiVersion: equipment.apiVersion, kind: 'EquipmentGroup', resource: 'equipmentgroups', label: '装备分组', requiredFields: ['displayName'],
  deletePath: '/apis/console.api.equipment.hanserwei.github.io/v1alpha1/equipmentgroups',
}
const momentConsole = '/apis/console.api.moment.halo.run/v1alpha1'
const moment: ResourceContract = {
  apiVersion: 'moment.halo.run/v1alpha1', kind: 'Moment', resource: 'moments', label: '瞬间', requiredFields: ['content', 'owner'],
  listPath: `${momentConsole}/moments`, createPath: `${momentConsole}/moments`,
}
const photoConsole = '/apis/console.api.photo.halo.run/v1alpha1'
const photo: ResourceContract = {
  apiVersion: 'core.halo.run/v1alpha1', kind: 'Photo', resource: 'photos', label: '图片', requiredFields: ['displayName', 'url'],
  listPath: `${photoConsole}/photos`, deletePath: `${photoConsole}/photos`,
}
const photoGroup: ResourceContract = {
  apiVersion: photo.apiVersion, kind: 'PhotoGroup', resource: 'photogroups', label: '图片分组', requiredFields: ['displayName'],
  deletePath: `${photoConsole}/photogroups`,
}
const linkConsole = '/apis/console.api.link.halo.run/v1alpha1'
const link: ResourceContract = {
  apiVersion: 'core.halo.run/v1alpha1', kind: 'Link', resource: 'links', label: '友链', requiredFields: ['displayName', 'url'],
  listPath: `${linkConsole}/links`,
}
const linkGroup: ResourceContract = {
  apiVersion: link.apiVersion, kind: 'LinkGroup', resource: 'linkgroups', label: '友链分组', requiredFields: ['displayName'],
  deletePath: `${linkConsole}/linkgroups`,
}

function resourcePath(contract: ResourceContract, name?: string): string {
  const [group, version] = contract.apiVersion.split('/')
  if (name !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name) || name.includes('..'))) {
    throw new CliError('资源名称必须是有效的 metadata.name。')
  }
  return customExtensionPath(group!, version!, contract.resource, name)
}

function addContentOptions(command: Command): Command {
  return addConfigurationConnectionOptions(command)
    .option('--file <path>', '完整资源或 spec 对象的 JSON 文件')
    .option('--spec <json>', 'spec 对象；敏感内容优先通过文件输入')
    .option('--display-name <name>', '显示名称')
    .option('--description <text>', '描述')
    .option('--resource-url <url>', '资源链接或图片地址；连接站点仍使用 --url')
    .option('--group <name>', '所属分组的 metadata.name')
    .option('--priority <number>', '排序优先级')
    .option('--content <markdown>', '瞬间 Markdown 正文')
    .option('--owner <username>', '瞬间所属用户名')
    .option('--visible <visibility>', '瞬间可见性，PUBLIC 或 PRIVATE')
    .option('--tags <tags>', '逗号分隔的标签，空字符串清空')
    .option('--dry-run', '预览请求，不修改资源')
    .option('--json', '输出 JSON')
}

async function inputSpec(options: ContentOptions): Promise<{ spec: Record<string, unknown>; metadata?: Record<string, unknown>; apiVersion?: unknown; kind?: unknown }> {
  const file = textValue(options.file, '--file')
  if (file !== undefined && options.spec !== undefined) throw new CliError('--file 和 --spec 不能同时使用。')
  const source = file !== undefined
    ? await readJsonObject(required(file, '--file'), '资源文件')
    : options.spec !== undefined ? parseJsonObject(required(textValue(options.spec, '--spec'), '--spec'), '--spec') : {}
  if (Object.hasOwn(source, 'spec') || Object.hasOwn(source, 'apiVersion') || Object.hasOwn(source, 'kind') || Object.hasOwn(source, 'metadata')) {
    if (!isJsonObject(source.spec)) throw new CliError('完整资源文件必须包含 spec 对象。')
    if (source.metadata !== undefined && !isJsonObject(source.metadata)) throw new CliError('metadata 必须是对象。')
    return { spec: source.spec, metadata: source.metadata as Record<string, unknown> | undefined, apiVersion: source.apiVersion, kind: source.kind }
  }
  return { spec: source }
}

function applyFlags(spec: Record<string, unknown>, options: ContentOptions): Record<string, unknown> {
  const result = structuredClone(spec)
  if (options.displayName !== undefined) result.displayName = options.displayName
  if (options.description !== undefined) result.description = options.description
  if (options.resourceUrl !== undefined) result.url = options.resourceUrl
  if (options.group !== undefined) result.groupName = options.group
  if (options.priority !== undefined) result.priority = integer(options.priority)
  if (options.content !== undefined) result.content = { raw: options.content, html: new MarkdownIt().render(options.content) }
  if (options.owner !== undefined) result.owner = required(options.owner, '--owner')
  if (options.visible !== undefined) {
    if (!['PUBLIC', 'PRIVATE'].includes(options.visible)) throw new CliError('--visible 必须为 PUBLIC 或 PRIVATE。')
    result.visible = options.visible
  }
  if (options.tags !== undefined) result.tags = csv(options.tags, '--tags') ?? []
  return result
}

function validateSpec(contract: ResourceContract, spec: Record<string, unknown>): void {
  for (const field of contract.requiredFields) {
    const value = spec[field]
    if (value === undefined || value === null || typeof value === 'string' && !value.trim()) {
      throw new CliError(`${contract.label}缺少 spec.${field}。可使用 --file 提供完整 JSON。`)
    }
  }
  if (contract.kind === 'Equipment' && spec.attributes !== undefined) {
    if (!Array.isArray(spec.attributes) || spec.attributes.some((entry) => !isJsonObject(entry)
      || typeof entry.label !== 'string' || !entry.label.trim() || typeof entry.value !== 'string' || !entry.value.trim())) {
      throw new CliError('attributes 必须是有序的 {label,value} 数组；允许重复 label。')
    }
  }
}

function registerResourceCommands(cli: CAC, contract: ResourceContract, prefix = ''): void {
  const list = prefix ? `${prefix}s` : 'list'
  const commandName = (action: string) => prefix ? `${prefix}-${action}` : action
  addConfigurationConnectionOptions(cli.command(list, `分页查询${contract.label}`))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--keyword <text>', '业务列表关键词筛选')
    .option('--json', '输出 JSON')
    .action(async (options: ContentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get(contract.listPath ?? resourcePath(contract), {
        params: { page: positiveInteger(options.page, 1), size: positiveInteger(options.size, 20), keyword: options.keyword },
      })
      printJson(response.data)
    })
  addConfigurationConnectionOptions(cli.command(`${commandName('get')} <name>`, `读取${contract.label}完整资源`))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ContentOptions) => {
      const { http } = await createHaloClient(options)
      printJson((await http.get(resourcePath(contract, name))).data)
    })
  addContentOptions(cli.command(commandName('create'), `创建${contract.label}；支持全部 spec 字段`))
    .option('--name <name>', '指定资源名；省略由 Halo 生成')
    .action(async (options: ContentOptions) => {
      const input = await inputSpec(options)
      if (input.apiVersion !== undefined && input.apiVersion !== contract.apiVersion || input.kind !== undefined && input.kind !== contract.kind) {
        throw new CliError('文件的 apiVersion/kind 与目标插件资源不匹配。')
      }
      const spec = applyFlags(input.spec, options)
      validateSpec(contract, spec)
      const name = options.name ?? input.metadata?.name
      if (name !== undefined && typeof name !== 'string') throw new CliError('metadata.name 必须是字符串。')
      if (name !== undefined) resourcePath(contract, name)
      const payload = {
        apiVersion: contract.apiVersion, kind: contract.kind,
        metadata: {
          ...(name ? { name } : { generateName: `${contract.kind.toLowerCase()}-` }),
          ...(isJsonObject(input.metadata?.labels) ? { labels: input.metadata.labels } : {}),
          ...(isJsonObject(input.metadata?.annotations) ? { annotations: input.metadata.annotations } : {}),
        }, spec,
      }
      if (options.dryRun) return printJson({ dryRun: true, resource: payload })
      const { http } = await createHaloClient(options)
      printJson((await http.post(contract.createPath ?? resourcePath(contract), payload)).data)
    })
  addContentOptions(cli.command(`${commandName('update')} <name>`, `部分更新${contract.label}，保留未指定字段和版本`))
    .action(async (name: string, options: ContentOptions) => {
      const path = resourcePath(contract, name)
      const input = await inputSpec(options)
      if (input.apiVersion !== undefined && input.apiVersion !== contract.apiVersion || input.kind !== undefined && input.kind !== contract.kind
        || input.metadata?.name !== undefined && input.metadata.name !== name) throw new CliError('文件身份与目标资源不匹配。')
      const patch = applyFlags(input.spec, options)
      if (!Object.keys(patch).length) throw new CliError('至少提供 --file、--spec 或一个修改字段。')
      const { http } = await createHaloClient(options)
      const current = (await http.get<HaloExtension>(path)).data
      const spec = mergeJsonObjects(current.spec ?? {}, patch)
      validateSpec(contract, spec)
      const updated = { ...current, spec }
      if (options.dryRun) return printJson({ dryRun: true, resource: updated })
      printJson((await http.put(path, updated)).data)
    })
  addConfigurationConnectionOptions(cli.command(`${commandName('delete')} <name>`, `删除${contract.label}${contract.kind === 'EquipmentGroup' ? '及组内装备' : ''}`))
    .option('--yes', '确认删除')
    .option('--with-attachment <boolean>', '图库图片同时删除关联附件，默认 false')
    .option('--delete-photos <boolean>', '删除图库分组时同时删除图片，默认 false；只解散分组')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ContentOptions) => {
      requireConfirmation(options.yes, `${commandName('delete')} ${name}`)
      const rawPath = resourcePath(contract, name)
      const path = contract.deletePath ? `${contract.deletePath}/${encodeURIComponent(name)}` : rawPath
      const { http } = await createHaloClient(options)
      if (contract.kind === 'Photo' || contract.kind === 'PhotoGroup') {
        const withAttachment = booleanValue(options.withAttachment, '--with-attachment') ?? false
        const deletePhotos = booleanValue(options.deletePhotos, '--delete-photos') ?? false
        if (contract.kind === 'PhotoGroup' && withAttachment && !deletePhotos) {
          throw new CliError('--with-attachment 需要同时指定 --delete-photos true。')
        }
        await http.delete(path, { params: contract.kind === 'Photo' ? { withAttachment } : { deletePhotos, withAttachment } })
      } else await http.delete(path)
      await waitForDeletion(http, rawPath)
      printJson({ name, deleted: true })
    })
}

export function registerEquipmentCommands(cli: CAC): void {
  registerResourceCommands(cli, equipment)
  registerResourceCommands(cli, equipmentGroup, 'group')
  addConfigurationConnectionOptions(cli.command('schema', '查看独立装备模型、结构化参数与配置命令'))
    .option('--json', '输出 JSON')
    .action(() => printJson({
      plugin: 'han-equipment', apiVersion: equipment.apiVersion, required: equipment.requiredFields,
      fields: ['displayName', 'groupName', 'specification', 'description', 'cover', 'url', 'priority', 'deviceType', 'status', 'featured', 'attributes'],
      attributes: { type: 'array', items: { label: 'string', value: 'string' }, ordered: true, duplicateLabels: true },
      settings: 'halo-cli plugin config-fields han-equipment',
    }))
}

export function registerMomentCommands(cli: CAC): void {
  registerResourceCommands(cli, moment)
  addConfigurationConnectionOptions(cli.command('tags', '查询瞬间标签'))
    .option('--json', '输出 JSON')
    .action(async (options: ContentOptions) => {
      const { http } = await createHaloClient(options)
      printJson((await http.get(`${momentConsole}/tags`)).data)
    })
}

export function registerPhotoCommands(cli: CAC): void {
  registerResourceCommands(cli, photo)
  registerResourceCommands(cli, photoGroup, 'group')
  addConfigurationConnectionOptions(cli.command('upload', '通过图库业务接口上传图片并提取 EXIF'))
    .option('--file <path>', '本地图片文件')
    .option('--group <name>', '图库 PhotoGroup 名称（不是附件分组）')
    .option('--json', '输出 JSON')
    .action(async (options: ContentOptions) => {
      const file = resolve(required(textValue(options.file, '--file'), '--file'))
      const imageTypes: Record<string, string | undefined> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif',
      }
      const type = imageTypes[extname(file).toLowerCase()]
      if (!type) throw new CliError('图库上传仅支持 JPEG、PNG、WebP、GIF、HEIC 或 HEIF 文件。')
      const form = new FormData()
      form.append('file', await openAsBlob(file, { type }), basename(file))
      if (options.group) form.append('group', options.group)
      const { http } = await createHaloClient(options)
      // The plugin chooses its configured base.policyName, including an S3 Policy.
      printJson((await http.post(`${photoConsole}/photos/upload`, form)).data)
    })
  addConfigurationConnectionOptions(cli.command('tags', '查询图片标签'))
    .option('--json', '输出 JSON')
    .action(async (options: ContentOptions) => {
      const { http } = await createHaloClient(options)
      printJson((await http.get(`${photoConsole}/photos/tags`)).data)
    })
}

export function registerLinkCommands(cli: CAC): void {
  registerResourceCommands(cli, link)
  registerResourceCommands(cli, linkGroup, 'group')
  for (const group of [false, true]) {
    addConfigurationConnectionOptions(cli.command(group ? 'group-sort' : 'sort', '按完整资源名称列表调整顺序'))
      .option('--names <names>', '逗号分隔的 metadata.name，按目标顺序排列')
      .option('--yes', '确认修改顺序')
      .option('--json', '输出 JSON')
      .action(async (options: ContentOptions) => {
        requireConfirmation(options.yes, group ? 'link group-sort' : 'link sort')
        const names = csv(options.names, '--names')
        if (!names?.length || new Set(names).size !== names.length) throw new CliError('--names 需要非空且不重复的资源名。')
        names.forEach((name) => resourcePath(group ? linkGroup : link, name))
        const { http } = await createHaloClient(options)
        const response = await http.post(`${linkConsole}/${group ? 'linkgroups' : 'links'}/-/sort`, { names })
        printJson(response.data || { sorted: true, names })
      })
  }
  for (const action of ['list', 'get', 'approve', 'reject', 'verify', 'delete']) {
    const takesName = action !== 'list'
    addConfigurationConnectionOptions(cli.command(`application-${action}${takesName ? ' <name>' : ''}`, '查询或处理友链申请'))
      .option('--file <path>', '审核请求 JSON，字段以服务端 Schema 为准')
      .option('--page <number>', '页码', { default: 1 })
      .option('--size <number>', '每页数量', { default: 20 })
      .option('--yes', '确认审核、验证或删除申请')
      .option('--json', '输出 JSON')
      .action(async (...args: unknown[]) => {
        const options = args.pop() as ContentOptions
        const name = takesName ? args[0] as string : undefined
        if (name) resourcePath(link, name)
        const path = `${linkConsole}/linkapplications${name ? `/${encodeURIComponent(name)}` : ''}`
        if (!['list', 'get'].includes(action)) requireConfirmation(options.yes, `link application-${action} ${name}`)
        const { http } = await createHaloClient(options)
        if (action === 'list' || action === 'get') {
          printJson((await http.get(path, action === 'list' ? { params: { page: positiveInteger(options.page, 1), size: positiveInteger(options.size, 20) } } : undefined)).data)
        } else if (action === 'delete') {
          await http.delete(path)
          printJson({ name, deleted: true })
        } else {
          const body = options.file ? await readJsonObject(required(textValue(options.file, '--file'), '--file'), '审核请求') : {}
          const response = await http.post(`${path}/${action}`, body)
          printJson(response.data || { name, action, submitted: true })
        }
      })
  }
}
