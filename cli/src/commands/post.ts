import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { CAC } from 'cac'
import MarkdownIt from 'markdown-it'

import { consolePostPath, createHaloClient, resourcePath, waitForDeletion } from '../client.js'
import { CliError } from '../errors.js'
import {
  booleanValue,
  csv,
  integer,
  positiveInteger,
  required,
  requiredContent,
  requireConfirmation,
  slugify,
} from '../options.js'
import { printJson, printPost, printPostList } from '../output.js'
import type {
  ConnectionOptions,
  Content,
  ContentWrapper,
  ListedPost,
  OutputOptions,
  Page,
  Post,
  PostRequest,
} from '../types.js'

const markdown = new MarkdownIt({ breaks: true, html: true, linkify: true })

interface PostOptions extends ConnectionOptions, OutputOptions {
  allowComment?: boolean | string
  categories?: string
  content?: string
  cover?: string
  excerpt?: string
  file?: string
  keyword?: string
  page?: string
  phase?: string
  pinned?: boolean | string
  priority?: string
  publish?: boolean
  rawType?: string
  size?: string
  slug?: string
  sort?: string
  tags?: string
  template?: string
  title?: string
  visible?: string
  yes?: boolean
}

function connection(options: ConnectionOptions) {
  return createHaloClient(options)
}

async function resolveRaw(options: Pick<PostOptions, 'content' | 'file'>): Promise<string | undefined> {
  if (options.content !== undefined && options.file) {
    throw new CliError('只能使用 --content 或 --file 中的一种方式提供正文。')
  }
  if (options.file) {
    return readFile(options.file, 'utf8')
  }
  return options.content
}

function renderContent(raw: string, rawType: string): string {
  return rawType.toLowerCase() === 'markdown' ? markdown.render(raw) : raw
}

function visibility(value: string | undefined, fallback: Post['spec']['visible']): Post['spec']['visible'] {
  const normalized = value?.toUpperCase()
  if (normalized === undefined) {
    return fallback
  }
  if (!['PUBLIC', 'INTERNAL', 'PRIVATE'].includes(normalized)) {
    throw new CliError('--visible 只能是 PUBLIC、INTERNAL 或 PRIVATE。')
  }
  return normalized as Post['spec']['visible']
}

export async function buildCreatePostRequest(options: PostOptions): Promise<PostRequest> {
  const title = required(options.title, '文章标题（--title）')
  const raw = requiredContent(await resolveRaw(options), '文章正文（--content 或 --file）')
  const rawType = options.rawType?.trim() || 'markdown'
  const excerpt = options.excerpt?.trim()

  return {
    post: {
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'Post',
      metadata: { name: randomUUID() },
      spec: {
        allowComment: booleanValue(options.allowComment, '--allow-comment') ?? true,
        categories: csv(options.categories),
        cover: options.cover?.trim() || undefined,
        deleted: false,
        excerpt: { autoGenerate: !excerpt, raw: excerpt },
        pinned: booleanValue(options.pinned, '--pinned') ?? false,
        priority: integer(options.priority),
        publish: false,
        slug: options.slug?.trim() || slugify(title, 'post'),
        tags: csv(options.tags),
        template: options.template?.trim() || undefined,
        title,
        visible: visibility(options.visible, 'PUBLIC'),
      },
    },
    content: { content: renderContent(raw, rawType), raw, rawType },
  }
}

export async function buildUpdatePostRequest(
  currentPost: Post,
  currentContent: ContentWrapper,
  options: PostOptions,
): Promise<PostRequest> {
  const suppliedRaw = await resolveRaw(options)
  const raw = suppliedRaw ?? currentContent.raw ?? ''
  const rawType = options.rawType?.trim() || currentContent.rawType || 'markdown'
  const nextExcerpt = options.excerpt?.trim()

  return {
    post: {
      ...currentPost,
      spec: {
        ...currentPost.spec,
        allowComment:
          booleanValue(options.allowComment, '--allow-comment') ?? currentPost.spec.allowComment,
        categories: csv(options.categories) ?? currentPost.spec.categories,
        cover: options.cover !== undefined ? options.cover.trim() || undefined : currentPost.spec.cover,
        excerpt:
          options.excerpt !== undefined
            ? { autoGenerate: !nextExcerpt, raw: nextExcerpt }
            : currentPost.spec.excerpt,
        pinned: booleanValue(options.pinned, '--pinned') ?? currentPost.spec.pinned,
        priority:
          options.priority !== undefined
            ? integer(options.priority)
            : currentPost.spec.priority,
        slug: options.slug?.trim() || currentPost.spec.slug,
        tags: csv(options.tags) ?? currentPost.spec.tags,
        template:
          options.template !== undefined
            ? options.template.trim() || undefined
            : currentPost.spec.template,
        title: options.title?.trim() || currentPost.spec.title,
        visible: visibility(options.visible, currentPost.spec.visible),
      },
    },
    content: {
      content: suppliedRaw !== undefined || options.rawType ? renderContent(raw, rawType) : currentContent.content ?? renderContent(raw, rawType),
      raw,
      rawType,
    },
  }
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

function addPostMutationOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--title <title>', '文章标题')
    .option('--slug <slug>', '文章别名')
    .option('--content <content>', '内联正文')
    .option('--file <path>', '从文件读取正文')
    .option('--raw-type <type>', '正文格式，默认 markdown')
    .option('--excerpt <excerpt>', '自定义摘要')
    .option('--categories <names>', '分类 metadata.name，逗号分隔')
    .option('--tags <names>', '标签 metadata.name，逗号分隔')
    .option('--cover <url>', '封面地址')
    .option('--template <name>', '主题模板名称')
    .option('--visible <visibility>', 'PUBLIC、INTERNAL 或 PRIVATE')
    .option('--pinned <boolean>', '是否置顶，true 或 false')
    .option('--allow-comment <boolean>', '是否允许评论，true 或 false')
    .option('--priority <number>', '排序优先级')
}

export function registerPostCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出文章'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--keyword <keyword>', '按标题、别名或摘要搜索')
    .option('--phase <phase>', 'DRAFT、PENDING_APPROVAL、PUBLISHED 或 FAILED')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,desc')
    .option('--json', '输出 JSON')
    .action(async (options: PostOptions) => {
      const { http } = await connection(options)
      const response = await http.get<Page<ListedPost>>(consolePostPath(), {
        params: {
          keyword: options.keyword?.trim() || undefined,
          labelSelector: ['content.halo.run/deleted=false'],
          page: positiveInteger(options.page, 1),
          publishPhase: options.phase?.toUpperCase(),
          size: positiveInteger(options.size, 20),
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
        },
      })
      printPostList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看文章及草稿正文'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PostOptions) => {
      const { http } = await connection(options)
      const [post, content] = await Promise.all([
        http.get<Post>(resourcePath('posts', name)),
        http.get<ContentWrapper>(consolePostPath(name, 'head-content')),
      ])
      printPost(post.data, content.data, options.json)
    })

  addPostMutationOptions(addConnectionOptions(cli.command('create', '创建文章草稿')))
    .option('--publish', '创建后立即发布')
    .option('--json', '输出 JSON')
    .action(async (options: PostOptions) => {
      const { http } = await connection(options)
      const payload = await buildCreatePostRequest(options)
      const created = await http.post<Post>(consolePostPath(), payload)
      const result = options.publish
        ? await http.put<Post>(consolePostPath(created.data.metadata.name, 'publish'))
        : created
      if (options.json) {
        printJson(result.data)
      } else {
        process.stdout.write(`已创建文章 ${result.data.metadata.name}${options.publish ? ' 并发布' : ''}。\n`)
      }
    })

  addPostMutationOptions(addConnectionOptions(cli.command('update <name>', '更新文章和草稿正文')))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PostOptions) => {
      const { http } = await connection(options)
      const [post, content] = await Promise.all([
        http.get<Post>(resourcePath('posts', name)),
        http.get<ContentWrapper>(consolePostPath(name, 'head-content')),
      ])
      const payload = await buildUpdatePostRequest(post.data, content.data, options)
      const response = await http.put<Post>(consolePostPath(name), payload)
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已更新文章 ${response.data.metadata.name}。\n`)
      }
    })

  for (const action of ['publish', 'unpublish'] as const) {
    addConnectionOptions(cli.command(`${action} <name>`, action === 'publish' ? '发布文章' : '取消发布文章'))
      .option('--json', '输出 JSON')
      .action(async (name: string, options: PostOptions) => {
        const { http } = await connection(options)
        const response = await http.put<Post>(consolePostPath(name, action))
        if (options.json) {
          printJson(response.data)
        } else {
          process.stdout.write(`文章 ${name} 已${action === 'publish' ? '发布' : '取消发布'}。\n`)
        }
      })
  }

  addConnectionOptions(cli.command('recycle <name>', '将文章移入回收站'))
    .option('--yes', '确认回收')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PostOptions) => {
      requireConfirmation(options.yes, `halo-cli post recycle ${name}`)
      const { http } = await connection(options)
      const response = await http.put<Post>(consolePostPath(name, 'recycle'))
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`文章 ${name} 已移入回收站。\n`)
      }
    })

  addConnectionOptions(cli.command('restore <name>', '从回收站恢复文章'))
    .option('--yes', '确认恢复')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PostOptions) => {
      requireConfirmation(options.yes, `halo-cli post restore ${name}`)
      const { http } = await connection(options)
      const current = (await http.get<Post>(resourcePath('posts', name))).data
      const response = await http.put<Post>(resourcePath('posts', name), {
        ...current,
        spec: { ...current.spec, deleted: false },
      })
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已从回收站恢复文章 ${name}。\n`)
      }
    })

  addConnectionOptions(cli.command('delete <name>', '永久删除文章'))
    .option('--yes', '确认永久删除')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PostOptions) => {
      requireConfirmation(options.yes, `halo-cli post delete ${name}`)
      const { http } = await connection(options)
      const path = resourcePath('posts', name)
      await http.delete(path)
      await waitForDeletion(http, path)
      const result = { deleted: true, name }
      if (options.json) {
        printJson(result)
      } else {
        process.stdout.write(`已永久删除文章 ${name}。\n`)
      }
    })
}
