import { randomUUID } from 'node:crypto'
import { createWriteStream, openAsBlob } from 'node:fs'
import { link, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import type { CAC } from 'cac'

import {
  consoleAttachmentPath,
  createHaloClient,
  hasSameOrigin,
  storagePath,
  waitForDeletion,
} from '../client.js'
import { CliError } from '../errors.js'
import {
  booleanValue,
  csv,
  positiveInteger,
  required,
  requireConfirmation,
  textValue,
} from '../options.js'
import {
  printAttachment,
  printAttachmentGroupList,
  printAttachmentList,
  printJson,
  printStoragePolicyList,
} from '../output.js'
import type {
  Attachment,
  AttachmentGroup,
  ConnectionOptions,
  JsonPatch,
  OutputOptions,
  Page,
  StoragePolicy,
} from '../types.js'
import { getPolicyTemplate, getStoragePolicy, storageRequest } from './storage.js'

interface AttachmentOptions extends ConnectionOptions, OutputOptions {
  accepts?: string
  displayName?: string
  dryRun?: boolean
  file?: string
  filename?: string
  force?: boolean
  group?: string
  keyword?: string
  output?: string
  owner?: string
  page?: string
  policy?: string
  preflight?: boolean
  size?: string
  sort?: string
  tags?: string
  ungrouped?: boolean | string
  yes?: boolean
}

export function buildAttachmentPatch(
  current: Attachment,
  options: Pick<AttachmentOptions, 'displayName' | 'group' | 'tags'>,
): JsonPatch[] {
  const patch: JsonPatch[] = []
  if (options.displayName !== undefined) {
    patch.push({
      op: 'add',
      path: '/spec/displayName',
      value: required(options.displayName, '附件显示名称（--display-name）'),
    })
  }
  const groupOption = textValue(options.group, '--group')
  if (groupOption !== undefined) {
    const group = groupOption.trim()
    if (group) patch.push({ op: 'add', path: '/spec/groupName', value: group })
    else if (current.spec.groupName) patch.push({ op: 'remove', path: '/spec/groupName' })
  }
  if (options.tags !== undefined) {
    patch.push({ op: 'add', path: '/spec/tags', value: csv(options.tags, '--tags') ?? [] })
  }
  if (!patch.length) {
    throw new CliError('请至少提供 --display-name、--group 或 --tags 中的一项。')
  }
  return patch
}

export async function downloadAttachmentToFile(
  http: AxiosInstance,
  baseUrl: string,
  permalink: string,
  output: string,
  force: boolean,
): Promise<{ size: number; url: string }> {
  if (!force && (await pathExists(output))) {
    throw new CliError(`文件已存在：${output}。如需覆盖，请添加 --force。`)
  }

  const temporaryOutput = `${output}.halo-cli-${process.pid}-${randomUUID()}.tmp`
  const file = await open(temporaryOutput, 'wx')
  let size = 0
  const authorization = http.defaults?.headers?.Authorization ?? http.defaults?.headers?.common?.Authorization
  const publicDownload = typeof authorization === 'string' && /^Bearer\s+hcli_/iu.test(authorization)
  try {
    let target = new URL(permalink, baseUrl)
    for (let redirects = 0; redirects <= 5; redirects++) {
      const authenticated = !publicDownload && hasSameOrigin(baseUrl, target.href)
      const requestUrl = authenticated ? `${target.pathname}${target.search}` : target.href
      const request = authenticated ? http : axios
      const response: AxiosResponse<Readable> = await request.get(requestUrl, {
        maxRedirects: 0,
        responseType: 'stream',
        ...(authenticated ? {} : { timeout: 30_000 }),
        validateStatus: (status) => status >= 200 && status < 400,
      })
      if (response.status >= 300) {
        response.data.destroy()
        const location = response.headers.location
        if (!location) {
          throw new CliError(`附件下载重定向缺少 Location（HTTP ${response.status}）。`)
        }
        target = new URL(location, target)
        continue
      }
      const writer = createWriteStream(temporaryOutput, { autoClose: false, fd: file.fd })
      await pipeline(response.data, writer)
      await file.close()
      size = writer.bytesWritten

      if (force) {
        await rename(temporaryOutput, output)
      } else {
        try {
          await link(temporaryOutput, output)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new CliError(`文件已存在：${output}。如需覆盖，请添加 --force。`)
          }
          throw error
        }
        await unlink(temporaryOutput)
      }
      return { size, url: target.href }
    }
    throw new CliError('附件下载重定向次数超过 5 次。')
  } catch (error) {
    await file.close().catch(() => undefined)
    await unlink(temporaryOutput).catch(() => undefined)
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function preflightAttachmentUpload(http: AxiosInstance, policyName: string, groupName?: string): Promise<void> {
  const policy = await getStoragePolicy(http, policyName)
  await getPolicyTemplate(http, required(policy.spec.templateName, '策略的 templateName'))
  if (groupName) {
    const group = (await storageRequest(() => http.get<AttachmentGroup>(storagePath('groups', groupName)))).data
    if (group.metadata.deletionTimestamp) throw new CliError('附件分组正在删除，不能上传。')
  }
  // Upload authorization must not require access to S3 credentials or ConfigMaps.
}

export async function uploadLocalAttachment(
  http: AxiosInstance,
  options: { file: string; policyName: string; groupName?: string; preflight?: boolean; dryRun?: boolean },
): Promise<Attachment | { dryRun: true; file: string; filename: string; size: number; policyName: string; groupName?: string }> {
  const file = resolve(options.file)
  const info = await stat(file).catch(() => { throw new CliError('无法读取本地上传文件，请检查路径及权限。') })
  if (!info.isFile()) throw new CliError('上传路径必须是普通文件。')
  const policyName = required(options.policyName, '存储策略（--policy）')
  const groupName = options.groupName?.trim() || undefined
  if (options.preflight || options.dryRun) await preflightAttachmentUpload(http, policyName, groupName)
  if (options.dryRun) return { dryRun: true, file, filename: basename(file), size: info.size, policyName, groupName }
  const form = new FormData()
  form.append('file', await openAsBlob(file), basename(file))
  form.append('policyName', policyName)
  if (groupName) form.append('groupName', groupName)
  return (await storageRequest(() => http.post<Attachment>(consoleAttachmentPath('upload'), form))).data
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

export function registerAttachmentCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出附件'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--policy <name>', '按存储策略 metadata.name 筛选')
    .option('--group <name>', '按分组 metadata.name 筛选')
    .option('--owner <name>', '按上传者 metadata.name 筛选')
    .option('--keyword <keyword>', '搜索附件')
    .option('--accepts <types>', '媒体类型，逗号分隔，例如 image/*,video/*')
    .option('--ungrouped', '仅查询未分组附件')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,desc')
    .option('--json', '输出 JSON')
    .action(async (options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const group = textValue(options.group, '--group')
      const fieldSelector = [
        options.policy?.trim() ? `spec.policyName=${options.policy.trim()}` : undefined,
        group?.trim() ? `spec.groupName=${group.trim()}` : undefined,
        options.owner?.trim() ? `spec.ownerName=${options.owner.trim()}` : undefined,
      ].filter(Boolean)
      const response = await http.get<Page<Attachment>>(consoleAttachmentPath(), {
        params: {
          accepts: csv(options.accepts, '--accepts'),
          fieldSelector,
          keyword: options.keyword?.trim() || undefined,
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 20),
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
          ungrouped: booleanValue(options.ungrouped, '--ungrouped'),
        },
      })
      printAttachmentList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看附件'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Attachment>(storagePath('attachments', name))
      printAttachment(response.data, options.json)
    })

  addConnectionOptions(cli.command('upload', '通过 Halo 上传本地附件，S3 使用策略实例名'))
    .option('--file <path>', '本地文件路径')
    .option('--policy <name>', '存储策略 metadata.name；不是模板名或桶名')
    .option('--group <name>', '附件分组 metadata.name')
    .option('--preflight', '上传前检查策略、模板和分组；不读取凭据')
    .option('--dry-run', '预检本地文件及策略，不上传')
    .option('--json', '输出 JSON')
    .action(async (options: AttachmentOptions) => {
      const file = required(textValue(options.file, '--file'), '本地文件（--file）')
      const policyName = required(textValue(options.policy, '--policy'), '存储策略（--policy）')
      const groupName = textValue(options.group, '--group')?.trim() || undefined
      const { http } = await createHaloClient(options)
      const result = await uploadLocalAttachment(http, { file, policyName, groupName, preflight: options.preflight, dryRun: options.dryRun })
      if (options.json || 'dryRun' in result) printJson(result)
      else process.stdout.write(`已上传附件 ${result.metadata.name}。\n`)
    })

  addConnectionOptions(cli.command('upload-url <url>', '通过 Halo 从 URL 转存附件'))
    .option('--policy <name>', '存储策略 metadata.name；不是模板名或桶名')
    .option('--group <name>', '附件分组 metadata.name')
    .option('--filename <name>', '保存时使用的文件名')
    .option('--preflight', '转存前检查策略、模板和分组；不读取凭据')
    .option('--dry-run', '预检策略并预览请求，不转存')
    .option('--json', '输出 JSON')
    .action(async (url: string, options: AttachmentOptions) => {
      let source: URL
      try { source = new URL(url) } catch { throw new CliError('转存 URL 必须是有效的 HTTP 或 HTTPS 地址。') }
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
        throw new CliError('转存 URL 必须使用 HTTP 或 HTTPS，且不能包含用户名或密码。')
      }
      const body = {
        filename: textValue(options.filename, '--filename')?.trim() || undefined,
        groupName: textValue(options.group, '--group')?.trim() || undefined,
        policyName: required(textValue(options.policy, '--policy'), '存储策略（--policy）'),
        url,
      }
      const { http } = await createHaloClient(options)
      if (options.preflight || options.dryRun) await preflightAttachmentUpload(http, body.policyName, body.groupName)
      if (options.dryRun) { printJson({ dryRun: true, ...body }); return }
      const response = await storageRequest(() => http.post<Attachment>(consoleAttachmentPath('-/upload-from-url'), body))
      if (options.json) printJson(response.data)
      else process.stdout.write(`已转存附件 ${response.data.metadata.name}。\n`)
    })

  addConnectionOptions(cli.command('update <name>', '更新附件显示名称、分组或标签'))
    .option('--display-name <name>', '附件显示名称')
    .option('--group <name>', '分组 metadata.name；空字符串表示取消分组')
    .option('--tags <tags>', '标签，逗号分隔；空字符串表示清空')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const path = storagePath('attachments', name)
      const current = (await http.get<Attachment>(path)).data
      const response = await http.patch<Attachment>(path, buildAttachmentPatch(current, options), {
        headers: { 'Content-Type': 'application/json-patch+json' },
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`已更新附件 ${name}。\n`)
    })

  addConnectionOptions(cli.command('download <name>', '下载附件'))
    .option('--output <path>', '输出文件路径，默认使用安全的附件显示名称')
    .option('--force', '覆盖已存在的文件')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: AttachmentOptions) => {
      const connection = await createHaloClient(options)
      const attachment = (
        await connection.http.get<Attachment>(storagePath('attachments', name))
      ).data
      const permalink = attachment.status?.permalink
      if (!permalink) throw new CliError(`附件 ${name} 没有可下载的 permalink。`)
      const candidateName = basename(attachment.spec.displayName?.trim() || name)
      const fallbackName = candidateName && candidateName !== '.' && candidateName !== '..' ? candidateName : name
      const output = resolve(options.output?.trim() || fallbackName)
      const downloaded = await downloadAttachmentToFile(
        connection.http,
        connection.url,
        permalink,
        output,
        options.force === true,
      )
      const result = { name, output, size: downloaded.size, url: downloaded.url }
      if (options.json) printJson(result)
      else process.stdout.write(`附件 ${name} 已下载到 ${output}。\n`)
    })

  addConnectionOptions(cli.command('delete <name>', '永久删除附件'))
    .option('--yes', '确认永久删除')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: AttachmentOptions) => {
      requireConfirmation(options.yes, `halo-cli attachment delete ${name}`)
      const { http } = await createHaloClient(options)
      const path = storagePath('attachments', name)
      await http.delete(path)
      await waitForDeletion(http, path)
      if (options.json) printJson({ deleted: true, name })
      else process.stdout.write(`已永久删除附件 ${name}。\n`)
    })

  addConnectionOptions(cli.command('policies', '列出附件存储策略'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--json', '输出 JSON')
    .action(async (options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Page<StoragePolicy>>(storagePath('policies'), {
        params: {
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 20),
        },
      })
      printStoragePolicyList(response.data, options.json)
    })

  addConnectionOptions(cli.command('groups', '列出附件分组'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--json', '输出 JSON')
    .action(async (options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Page<AttachmentGroup>>(storagePath('groups'), {
        params: {
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 20),
        },
      })
      printAttachmentGroupList(response.data, options.json)
    })
}
