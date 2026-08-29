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

interface AttachmentOptions extends ConnectionOptions, OutputOptions {
  accepts?: string
  displayName?: string
  file?: string
  filename?: string
  force?: boolean
  group?: string
  keyword?: string
  output?: string
  owner?: string
  page?: string
  policy?: string
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
  try {
    let target = new URL(permalink, baseUrl)
    for (let redirects = 0; redirects <= 5; redirects++) {
      const authenticated = hasSameOrigin(baseUrl, target.href)
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

  addConnectionOptions(cli.command('upload', '上传本地附件'))
    .option('--file <path>', '本地文件路径')
    .option('--policy <name>', '存储策略 metadata.name')
    .option('--group <name>', '附件分组 metadata.name')
    .option('--json', '输出 JSON')
    .action(async (options: AttachmentOptions) => {
      const file = resolve(required(options.file, '本地文件（--file）'))
      const policy = required(options.policy, '存储策略（--policy）')
      const group = textValue(options.group, '--group')
      const form = new FormData()
      form.append('file', await openAsBlob(file), basename(file))
      form.append('policyName', policy)
      if (group?.trim()) form.append('groupName', group.trim())
      const { http } = await createHaloClient(options)
      const response = await http.post<Attachment>(consoleAttachmentPath('upload'), form)
      if (options.json) printJson(response.data)
      else process.stdout.write(`已上传附件 ${response.data.metadata.name}。\n`)
    })

  addConnectionOptions(cli.command('upload-url <url>', '从 URL 转存附件'))
    .option('--policy <name>', '存储策略 metadata.name')
    .option('--group <name>', '附件分组 metadata.name')
    .option('--filename <name>', '保存时使用的文件名')
    .option('--json', '输出 JSON')
    .action(async (url: string, options: AttachmentOptions) => {
      const { http } = await createHaloClient(options)
      const group = textValue(options.group, '--group')
      const response = await http.post<Attachment>(consoleAttachmentPath('-/upload-from-url'), {
        filename: options.filename?.trim() || undefined,
        groupName: group?.trim() || undefined,
        policyName: required(options.policy, '存储策略（--policy）'),
        url,
      })
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
