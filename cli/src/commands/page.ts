import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { CAC } from 'cac'
import MarkdownIt from 'markdown-it'

import {
  consoleSinglePagePath,
  createHaloClient,
  resourcePath,
  waitForDeletion,
} from '../client.js'
import { CliError } from '../errors.js'
import {
  booleanValue,
  integer,
  positiveInteger,
  required,
  requiredContent,
  requireConfirmation,
  slugify,
} from '../options.js'
import { printJson, printSinglePage, printSinglePageList, printSnapshotList } from '../output.js'
import type {
  ConnectionOptions,
  ContentWrapper,
  ListedSinglePage,
  ListedSnapshot,
  OutputOptions,
  Page,
  SinglePage,
  SinglePageRequest,
} from '../types.js'

const markdown = new MarkdownIt({ breaks: true, html: true, linkify: true })

interface PageOptions extends ConnectionOptions, OutputOptions {
  allowComment?: boolean | string
  content?: string
  cover?: string
  deleted?: boolean | string
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
  template?: string
  title?: string
  visible?: string
  yes?: boolean
}

async function resolveRaw(options: Pick<PageOptions, 'content' | 'file'>): Promise<string | undefined> {
  if (options.content !== undefined && options.file) {
    throw new CliError('只能使用 --content 或 --file 中的一种方式提供正文。')
  }
  return options.file ? readFile(options.file, 'utf8') : options.content
}

function renderContent(raw: string, rawType: string): string {
  return rawType.toLowerCase() === 'markdown' ? markdown.render(raw) : raw
}

export function pageVisibility(
  value: string | undefined,
  fallback: SinglePage['spec']['visible'],
): SinglePage['spec']['visible'] {
  const normalized = value?.trim().toUpperCase()
  if (normalized === undefined) return fallback
  if (!['PUBLIC', 'INTERNAL', 'PRIVATE'].includes(normalized)) {
    throw new CliError('--visible 只能是 PUBLIC、INTERNAL 或 PRIVATE。')
  }
  return normalized as SinglePage['spec']['visible']
}

export function pagePhase(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  if (!normalized) return undefined
  if (!['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'FAILED'].includes(normalized)) {
    throw new CliError('--phase 只能是 DRAFT、PENDING_APPROVAL、PUBLISHED 或 FAILED。')
  }
  return normalized
}

export function ensureSnapshotCanRevert(page: SinglePage, snapshot: string): void {
  if (page.spec.headSnapshot === snapshot) {
    throw new CliError(
      `快照 ${snapshot} 已是页面 ${page.metadata.name} 的当前草稿内容；如需发布，请运行 halo-cli page publish ${page.metadata.name}。`,
    )
  }
}

export async function buildCreateSinglePageRequest(options: PageOptions): Promise<SinglePageRequest> {
  const title = required(options.title, '页面标题（--title）')
  const raw = requiredContent(await resolveRaw(options), '页面正文（--content 或 --file）')
  const rawType = options.rawType?.trim() || 'markdown'
  const excerpt = options.excerpt?.trim()
  return {
    page: {
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'SinglePage',
      metadata: { name: randomUUID() },
      spec: {
        allowComment: booleanValue(options.allowComment, '--allow-comment') ?? true,
        cover: options.cover?.trim() || undefined,
        deleted: false,
        excerpt: { autoGenerate: !excerpt, raw: excerpt },
        pinned: booleanValue(options.pinned, '--pinned') ?? false,
        priority: integer(options.priority),
        publish: false,
        slug: options.slug?.trim() || slugify(title, 'page'),
        template: options.template?.trim() || undefined,
        title,
        visible: pageVisibility(options.visible, 'PUBLIC'),
      },
    },
    content: { content: renderContent(raw, rawType), raw, rawType },
  }
}

export async function buildUpdateSinglePageRequest(
  currentPage: SinglePage,
  currentContent: ContentWrapper,
  options: PageOptions,
): Promise<SinglePageRequest> {
  const suppliedRaw = await resolveRaw(options)
  const raw = suppliedRaw ?? currentContent.raw ?? ''
  const rawType = options.rawType?.trim() || currentContent.rawType || 'markdown'
  const excerpt = options.excerpt?.trim()
  return {
    page: {
      ...currentPage,
      spec: {
        ...currentPage.spec,
        allowComment:
          booleanValue(options.allowComment, '--allow-comment') ?? currentPage.spec.allowComment,
        cover:
          options.cover !== undefined ? options.cover.trim() || undefined : currentPage.spec.cover,
        excerpt:
          options.excerpt !== undefined
            ? { autoGenerate: !excerpt, raw: excerpt }
            : currentPage.spec.excerpt,
        pinned: booleanValue(options.pinned, '--pinned') ?? currentPage.spec.pinned,
        priority:
          options.priority !== undefined ? integer(options.priority) : currentPage.spec.priority,
        slug: options.slug?.trim() || currentPage.spec.slug,
        template:
          options.template !== undefined
            ? options.template.trim() || undefined
            : currentPage.spec.template,
        title: options.title?.trim() || currentPage.spec.title,
        visible: pageVisibility(options.visible, currentPage.spec.visible),
      },
    },
    content: {
      content:
        suppliedRaw !== undefined || options.rawType
          ? renderContent(raw, rawType)
          : currentContent.content ?? renderContent(raw, rawType),
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

function addMutationOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--title <title>', '页面标题')
    .option('--slug <slug>', '页面别名')
    .option('--content <content>', '内联正文')
    .option('--file <path>', '从文件读取正文')
    .option('--raw-type <type>', '正文格式，默认 markdown')
    .option('--excerpt <excerpt>', '自定义摘要')
    .option('--cover <url>', '封面地址')
    .option('--template <name>', '主题模板名称')
    .option('--visible <visibility>', 'PUBLIC、INTERNAL 或 PRIVATE')
    .option('--pinned <boolean>', '是否置顶，true 或 false')
    .option('--allow-comment <boolean>', '是否允许评论，true 或 false')
    .option('--priority <number>', '排序优先级')
}

export function registerPageCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出页面'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--keyword <keyword>', '按标题、别名或摘要搜索')
    .option('--phase <phase>', 'DRAFT、PENDING_APPROVAL、PUBLISHED 或 FAILED')
    .option('--visible <visibility>', 'PUBLIC、INTERNAL 或 PRIVATE')
    .option('--deleted <boolean>', '是否查询回收站，true 或 false')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,desc')
    .option('--json', '输出 JSON')
    .action(async (options: PageOptions) => {
      const publishPhase = pagePhase(options.phase)
      const visible = pageVisibility(options.visible, 'PUBLIC')
      const { http } = await createHaloClient(options)
      const deleted = booleanValue(options.deleted, '--deleted') ?? false
      const response = await http.get<Page<ListedSinglePage>>(consoleSinglePagePath(), {
        params: {
          keyword: options.keyword?.trim() || undefined,
          labelSelector: [`content.halo.run/deleted=${deleted}`],
          page: positiveInteger(options.page, 1),
          publishPhase,
          size: positiveInteger(options.size, 20),
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
          visible: options.visible === undefined ? undefined : visible,
        },
      })
      printSinglePageList(response.data, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看页面及草稿正文'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const [page, content] = await Promise.all([
        http.get<SinglePage>(resourcePath('singlepages', name)),
        http.get<ContentWrapper>(consoleSinglePagePath(name, 'head-content')),
      ])
      printSinglePage(page.data, content.data, options.json)
    })

  addMutationOptions(addConnectionOptions(cli.command('create', '创建页面草稿')))
    .option('--publish', '创建后立即发布')
    .option('--json', '输出 JSON')
    .action(async (options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const payload = await buildCreateSinglePageRequest(options)
      const created = await http.post<SinglePage>(consoleSinglePagePath(), payload)
      const result = options.publish
        ? await http.put<SinglePage>(consoleSinglePagePath(created.data.metadata.name, 'publish'))
        : created
      if (options.json) printJson(result.data)
      else process.stdout.write(`已创建页面 ${result.data.metadata.name}${options.publish ? ' 并发布' : ''}。\n`)
    })

  addMutationOptions(addConnectionOptions(cli.command('update <name>', '更新页面和草稿正文')))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const [page, content] = await Promise.all([
        http.get<SinglePage>(resourcePath('singlepages', name)),
        http.get<ContentWrapper>(consoleSinglePagePath(name, 'head-content')),
      ])
      const payload = await buildUpdateSinglePageRequest(page.data, content.data, options)
      const response = await http.put<SinglePage>(consoleSinglePagePath(name), payload)
      if (options.json) printJson(response.data)
      else process.stdout.write(`已更新页面 ${name}。\n`)
    })

  addConnectionOptions(cli.command('publish <name>', '发布页面'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.put<SinglePage>(consoleSinglePagePath(name, 'publish'))
      if (options.json) printJson(response.data)
      else process.stdout.write(`页面 ${name} 已发布。\n`)
    })

  addConnectionOptions(cli.command('unpublish <name>', '取消发布页面'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const path = resourcePath('singlepages', name)
      const current = (await http.get<SinglePage>(path)).data
      const response = await http.put<SinglePage>(path, {
        ...current,
        spec: { ...current.spec, publish: false },
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`页面 ${name} 已取消发布。\n`)
    })

  for (const action of ['recycle', 'restore'] as const) {
    addConnectionOptions(
      cli.command(`${action} <name>`, action === 'recycle' ? '将页面移入回收站' : '从回收站恢复页面'),
    )
      .option('--yes', '确认操作')
      .option('--json', '输出 JSON')
      .action(async (name: string, options: PageOptions) => {
        requireConfirmation(options.yes, `halo-cli page ${action} ${name}`)
        const { http } = await createHaloClient(options)
        const path = resourcePath('singlepages', name)
        const current = (await http.get<SinglePage>(path)).data
        const response = await http.put<SinglePage>(path, {
          ...current,
          spec: { ...current.spec, deleted: action === 'recycle' },
        })
        if (options.json) printJson(response.data)
        else process.stdout.write(`页面 ${name} 已${action === 'recycle' ? '移入回收站' : '恢复'}。\n`)
      })
  }

  addConnectionOptions(cli.command('delete <name>', '永久删除页面'))
    .option('--yes', '确认永久删除')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      requireConfirmation(options.yes, `halo-cli page delete ${name}`)
      const { http } = await createHaloClient(options)
      const path = resourcePath('singlepages', name)
      await http.delete(path)
      await waitForDeletion(http, path)
      if (options.json) printJson({ deleted: true, name })
      else process.stdout.write(`已永久删除页面 ${name}。\n`)
    })

  addConnectionOptions(cli.command('snapshot-list <name>', '列出页面内容快照'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<ListedSnapshot[]>(consoleSinglePagePath(name, 'snapshot'))
      printSnapshotList(response.data, options.json)
    })

  addConnectionOptions(cli.command('snapshot-get <name> <snapshot>', '查看页面内容快照'))
    .option('--json', '输出 JSON')
    .action(async (name: string, snapshot: string, options: PageOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<ContentWrapper>(consoleSinglePagePath(name, 'content'), {
        params: { snapshotName: snapshot },
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`${response.data.raw ?? response.data.content ?? ''}\n`)
    })

  addConnectionOptions(cli.command('snapshot-revert <name> <snapshot>', '恢复页面内容快照并发布'))
    .option('--yes', '确认覆盖当前内容并发布')
    .option('--json', '输出 JSON')
    .action(async (name: string, snapshot: string, options: PageOptions) => {
      requireConfirmation(
        options.yes,
        `halo-cli page snapshot-revert ${name} ${snapshot}`,
      )
      const { http } = await createHaloClient(options)
      const current = (await http.get<SinglePage>(resourcePath('singlepages', name))).data
      ensureSnapshotCanRevert(current, snapshot)
      const response = await http.put<SinglePage>(consoleSinglePagePath(name, 'revert-content'), {
        snapshotName: snapshot,
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`页面 ${name} 已恢复到快照 ${snapshot} 并发布。\n`)
    })

  addConnectionOptions(cli.command('snapshot-delete <name> <snapshot>', '删除页面内容快照'))
    .option('--yes', '确认删除快照')
    .option('--json', '输出 JSON')
    .action(async (name: string, snapshot: string, options: PageOptions) => {
      requireConfirmation(options.yes, `halo-cli page snapshot-delete ${name} ${snapshot}`)
      const { http } = await createHaloClient(options)
      const response = await http.delete<ContentWrapper>(consoleSinglePagePath(name, 'content'), {
        params: { snapshotName: snapshot },
      })
      if (options.json) printJson(response.data)
      else process.stdout.write(`已删除页面 ${name} 的快照 ${snapshot}。\n`)
    })
}
