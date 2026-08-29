import type { CAC } from 'cac'

import {
  consoleCommentPath,
  consoleReplyPath,
  createHaloClient,
  resourcePath,
  waitForDeletion,
} from '../client.js'
import { CliError } from '../errors.js'
import {
  booleanValue,
  positiveInteger,
  requiredContent,
  requireConfirmation,
} from '../options.js'
import {
  printComment,
  printCommentList,
  printJson,
  printReply,
  printReplyList,
} from '../output.js'
import type {
  Comment,
  ConnectionOptions,
  JsonPatch,
  ListedComment,
  ListedReply,
  OutputOptions,
  Page,
  Reply,
  ReplyRequest,
} from '../types.js'

interface CommentOptions extends ConnectionOptions, OutputOptions {
  allowNotification?: boolean | string
  approved?: boolean | string
  content?: string
  hidden?: boolean | string
  keyword?: string
  owner?: string
  page?: string
  quote?: string
  size?: string
  sort?: string
  subject?: string
  yes?: boolean
}

export function buildModerationPatch(approved: boolean, now = new Date()): JsonPatch[] {
  return [
    { op: 'add', path: '/spec/approved', value: approved },
    { op: 'add', path: '/spec/approvedTime', value: approved ? now.toISOString() : '' },
  ]
}

export function buildReplyRequest(options: CommentOptions): ReplyRequest {
  const content = requiredContent(options.content, '回复内容（--content）')
  return {
    allowNotification: booleanValue(options.allowNotification, '--allow-notification') ?? true,
    content,
    hidden: booleanValue(options.hidden, '--hidden'),
    quoteReply: options.quote?.trim() || undefined,
    raw: content,
  }
}

export function normalizeSubjectRef(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const components = value.split('/').map((component) => component.trim())
  if (components.length !== 3 || components.some((component) => !component)) {
    throw new CliError('--subject 必须使用 group/kind/name 格式，且每一部分都不能为空。')
  }
  return components.join('/')
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

async function moderate(
  resource: 'comments' | 'replies',
  name: string,
  approved: boolean,
  options: CommentOptions,
): Promise<void> {
  const { http } = await createHaloClient(options)
  const response = await http.patch<Comment | Reply>(
    resourcePath(resource, name),
    buildModerationPatch(approved),
    { headers: { 'Content-Type': 'application/json-patch+json' } },
  )
  if (options.json) printJson(response.data)
  else process.stdout.write(`${resource === 'comments' ? '评论' : '回复'} ${name} 已${approved ? '批准' : '取消批准'}。\n`)
}

async function deleteResource(
  resource: 'comments' | 'replies',
  name: string,
  options: CommentOptions,
): Promise<void> {
  requireConfirmation(options.yes, `halo-cli comment ${resource === 'comments' ? 'delete' : 'reply-delete'} ${name}`)
  const { http } = await createHaloClient(options)
  const path = resourcePath(resource, name)
  await http.delete(path)
  await waitForDeletion(http, path)
  if (options.json) printJson({ deleted: true, name })
  else process.stdout.write(`已删除${resource === 'comments' ? '评论' : '回复'} ${name}。\n`)
}

export function registerCommentCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出评论'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--approved <boolean>', '按批准状态筛选，true 或 false')
    .option('--subject <ref>', '按主题引用筛选，格式 group/kind/name')
    .option('--owner <name>', '按评论者 metadata.name 筛选')
    .option('--keyword <keyword>', '按评论原文搜索')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,desc')
    .option('--json', '输出 JSON')
    .action(async (options: CommentOptions) => {
      const subject = normalizeSubjectRef(options.subject)
      const { http } = await createHaloClient(options)
      const approved = booleanValue(options.approved, '--approved')
      const fieldSelector = [
        approved === undefined ? undefined : `spec.approved=${approved}`,
        subject ? `spec.subjectRef=${subject}` : undefined,
      ].filter(Boolean)
      const response = await http.get<Page<ListedComment>>(consoleCommentPath(), {
        params: {
          fieldSelector,
          keyword: options.keyword?.trim() || undefined,
          ownerKind: options.owner?.trim() ? 'User' : undefined,
          ownerName: options.owner?.trim() || undefined,
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 20),
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
        },
      })
      printCommentList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看评论'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: CommentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Comment>(resourcePath('comments', name))
      printComment(response.data, options.json)
    })

  for (const approved of [true, false]) {
    const command = approved ? 'approve' : 'unapprove'
    addConnectionOptions(cli.command(`${command} <name>`, `${approved ? '批准' : '取消批准'}评论`))
      .option('--json', '输出 JSON')
      .action((name: string, options: CommentOptions) => moderate('comments', name, approved, options))
  }

  addConnectionOptions(cli.command('delete <name>', '删除评论及其回复'))
    .option('--yes', '确认删除')
    .option('--json', '输出 JSON')
    .action((name: string, options: CommentOptions) => deleteResource('comments', name, options))

  addConnectionOptions(cli.command('replies <comment-name>', '列出评论回复'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--approved <boolean>', '按批准状态筛选，true 或 false')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,asc')
    .option('--json', '输出 JSON')
    .action(async (commentName: string, options: CommentOptions) => {
      const { http } = await createHaloClient(options)
      const approved = booleanValue(options.approved, '--approved')
      const response = await http.get<Page<ListedReply>>(consoleReplyPath(), {
        params: {
          commentName,
          fieldSelector: approved === undefined ? undefined : [`spec.approved=${approved}`],
          page: positiveInteger(options.page, 1),
          size: positiveInteger(options.size, 20),
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
        },
      })
      printReplyList(response.data, options.json)
    })

  addConnectionOptions(cli.command('reply <comment-name>', '创建评论回复'))
    .option('--content <content>', '回复内容')
    .option('--quote <reply-name>', '引用的回复 metadata.name')
    .option('--hidden <boolean>', '是否隐藏，true 或 false')
    .option('--allow-notification <boolean>', '是否允许通知，true 或 false')
    .option('--json', '输出 JSON')
    .action(async (commentName: string, options: CommentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.post<Reply>(
        consoleCommentPath(commentName, 'reply'),
        buildReplyRequest(options),
      )
      if (options.json) printJson(response.data)
      else process.stdout.write(`已创建回复 ${response.data.metadata.name}。\n`)
    })

  addConnectionOptions(cli.command('reply-get <name>', '查看回复'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: CommentOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Reply>(resourcePath('replies', name))
      printReply(response.data, options.json)
    })

  for (const approved of [true, false]) {
    const command = approved ? 'reply-approve' : 'reply-unapprove'
    addConnectionOptions(cli.command(`${command} <name>`, `${approved ? '批准' : '取消批准'}回复`))
      .option('--json', '输出 JSON')
      .action((name: string, options: CommentOptions) => moderate('replies', name, approved, options))
  }

  addConnectionOptions(cli.command('reply-delete <name>', '删除回复'))
    .option('--yes', '确认删除')
    .option('--json', '输出 JSON')
    .action((name: string, options: CommentOptions) => deleteResource('replies', name, options))
}
