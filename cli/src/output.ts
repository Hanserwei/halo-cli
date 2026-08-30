import Table from 'cli-table3'

import type {
  Attachment,
    AttachmentGroup,
    Category,
    Comment,
    ContentWrapper,
    HaloExtension,
  ListedComment,
  ListedPost,
  ListedReply,
  ListedSinglePage,
  ListedSnapshot,
  Menu,
  MenuItem,
  MenuItemTreeNode,
  Page,
  Post,
  Plugin,
  Reply,
  SinglePage,
  StoragePolicy,
  Tag,
  Theme,
} from './types.js'

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function timestamp(value?: string | null): string {
  return value ? value.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '-'
}

function printTable(head: string[], rows: Array<Array<string | number>>): void {
  const table = new Table({ head })
  table.push(...rows)
  process.stdout.write(`${table.toString()}\n`)
}

function preview(value: string, length = 48): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact || '-'
}

export function printPostList(page: Page<ListedPost>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'TITLE', 'PHASE', 'UPDATED'],
    page.items.map(({ post }) => [
      post.metadata.name,
      post.spec.title,
      post.status?.phase ?? (post.spec.publish ? 'PUBLISHING' : 'DRAFT'),
      timestamp(post.status?.lastModifyTime ?? post.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 篇文章\n`)
}

export function printPost(post: Post, content: unknown, json = false): void {
  if (json) {
    printJson({ post, content })
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', post.metadata.name],
    ['Title', post.spec.title],
    ['Slug', post.spec.slug],
    ['Phase', post.status?.phase ?? (post.spec.publish ? 'PUBLISHING' : 'DRAFT')],
    ['Visibility', post.spec.visible],
    ['Categories', post.spec.categories?.join(', ') || '-'],
    ['Tags', post.spec.tags?.join(', ') || '-'],
    ['Permalink', post.status?.permalink ?? '-'],
  ])
}

export function printSinglePageList(page: Page<ListedSinglePage>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'TITLE', 'PHASE', 'VISIBILITY', 'UPDATED'],
    page.items.map(({ page: singlePage }) => [
      singlePage.metadata.name,
      singlePage.spec.title,
      singlePage.status?.phase ?? (singlePage.spec.publish ? 'PUBLISHING' : 'DRAFT'),
      singlePage.spec.visible,
      timestamp(singlePage.status?.lastModifyTime ?? singlePage.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个页面\n`)
}

export function printSinglePage(page: SinglePage, content: ContentWrapper, json = false): void {
  if (json) {
    printJson({ page, content })
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', page.metadata.name],
    ['Title', page.spec.title],
    ['Slug', page.spec.slug],
    ['Phase', page.status?.phase ?? (page.spec.publish ? 'PUBLISHING' : 'DRAFT')],
    ['Visibility', page.spec.visible],
    ['Deleted', String(page.spec.deleted)],
    ['Permalink', page.status?.permalink ?? '-'],
  ])
  process.stdout.write(`\n${content.raw ?? content.content ?? ''}\n`)
}

export function printSnapshotList(snapshots: ListedSnapshot[], json = false): void {
  if (json) {
    printJson(snapshots)
    return
  }
  printTable(
    ['NAME', 'OWNER', 'MODIFIED'],
    snapshots.map((snapshot) => [
      snapshot.metadata.name,
      snapshot.spec.owner,
      timestamp(snapshot.spec.modifyTime ?? snapshot.metadata.creationTimestamp),
    ]),
  )
}

export function printCommentList(page: Page<ListedComment>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'CONTENT', 'APPROVED', 'SUBJECT', 'CREATED'],
    page.items.map(({ comment }) => [
      comment.metadata.name,
      preview(comment.spec.raw),
      String(comment.spec.approved),
      `${comment.spec.subjectRef.kind}/${comment.spec.subjectRef.name}`,
      timestamp(comment.spec.creationTime ?? comment.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 条评论\n`)
}

export function printComment(comment: Comment, json = false): void {
  if (json) {
    printJson(comment)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', comment.metadata.name],
    ['Approved', String(comment.spec.approved)],
    ['Hidden', String(comment.spec.hidden)],
    ['Subject', `${comment.spec.subjectRef.group}/${comment.spec.subjectRef.version}/${comment.spec.subjectRef.kind}/${comment.spec.subjectRef.name}`],
    ['Content', preview(comment.spec.raw, 120)],
  ])
}

export function printReplyList(page: Page<ListedReply>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'CONTENT', 'APPROVED', 'QUOTE', 'CREATED'],
    page.items.map(({ reply }) => [
      reply.metadata.name,
      preview(reply.spec.raw),
      String(reply.spec.approved),
      reply.spec.quoteReply ?? '-',
      timestamp(reply.spec.creationTime ?? reply.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 条回复\n`)
}

export function printReply(reply: Reply, json = false): void {
  if (json) {
    printJson(reply)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', reply.metadata.name],
    ['Comment', reply.spec.commentName],
    ['Approved', String(reply.spec.approved)],
    ['Hidden', String(reply.spec.hidden)],
    ['Quote', reply.spec.quoteReply ?? '-'],
    ['Content', preview(reply.spec.raw, 120)],
  ])
}

export function printAttachmentList(page: Page<Attachment>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'TYPE', 'SIZE', 'POLICY', 'GROUP'],
    page.items.map((attachment) => [
      attachment.metadata.name,
      attachment.spec.displayName ?? '-',
      attachment.spec.mediaType ?? '-',
      attachment.spec.size ?? 0,
      attachment.spec.policyName ?? '-',
      attachment.spec.groupName ?? '-',
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个附件\n`)
}

export function printAttachment(attachment: Attachment, json = false): void {
  if (json) {
    printJson(attachment)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', attachment.metadata.name],
    ['Display name', attachment.spec.displayName ?? '-'],
    ['Media type', attachment.spec.mediaType ?? '-'],
    ['Size', attachment.spec.size ?? 0],
    ['Policy', attachment.spec.policyName ?? '-'],
    ['Group', attachment.spec.groupName ?? '-'],
    ['Tags', attachment.spec.tags?.join(', ') || '-'],
    ['Permalink', attachment.status?.permalink ?? '-'],
  ])
}

export function printStoragePolicyList(page: Page<StoragePolicy>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'TEMPLATE'],
    page.items.map((policy) => [
      policy.metadata.name,
      policy.spec.displayName,
      policy.spec.templateName ?? '-',
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个存储策略\n`)
}

export function printAttachmentGroupList(page: Page<AttachmentGroup>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME'],
    page.items.map((group) => [group.metadata.name, group.spec.displayName]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个附件分组\n`)
}

export function printMenuList(
  page: Page<Menu>,
  primary: string | undefined,
  itemCounts: Record<string, number>,
  json = false,
): void {
  if (json) {
    printJson({ ...page, itemCounts, primary })
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'PRIMARY', 'ITEMS', 'CREATED'],
    page.items.map((menu) => [
      menu.metadata.name,
      menu.spec.displayName,
      menu.metadata.name === primary ? 'yes' : '-',
      itemCounts[menu.metadata.name] ?? 0,
      timestamp(menu.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个菜单\n`)
}

export function printMenu(menu: Menu, json = false): void {
  if (json) {
    printJson(menu)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', menu.metadata.name],
    ['Display name', menu.spec.displayName],
    ['Created', timestamp(menu.metadata.creationTimestamp)],
    ['Deleting', String(Boolean(menu.metadata.deletionTimestamp))],
  ])
}

export function printMenuItem(menuItem: MenuItem, json = false): void {
  if (json) {
    printJson(menuItem)
    return
  }
  const ref = menuItem.spec.targetRef
  printTable(['FIELD', 'VALUE'], [
    ['Name', menuItem.metadata.name],
    ['Menu', menuItem.spec.menuName ?? '-'],
    ['Parent', menuItem.spec.parent ?? '-'],
    ['Display name', menuItem.status?.displayName ?? menuItem.spec.displayName ?? '-'],
    ['Href', menuItem.status?.href ?? menuItem.spec.href ?? '-'],
    ['Target', menuItem.spec.target ?? '_self'],
    ['Priority', menuItem.spec.priority ?? 0],
    ['Source', ref ? `${ref.kind}/${ref.name}` : 'custom'],
  ])
}

export function printMenuItemTree(tree: MenuItemTreeNode[], json = false): void {
  if (json) {
    printJson(tree)
    return
  }
  const rows: Array<Array<string | number>> = []
  const visit = (nodes: MenuItemTreeNode[], depth: number) => {
    for (const node of nodes) {
      const item = node.menuItem
      const ref = item.spec.targetRef
      rows.push([
        depth,
        item.metadata.name,
        `${'  '.repeat(depth)}${item.status?.displayName ?? item.spec.displayName ?? '-'}`,
        item.status?.href ?? item.spec.href ?? '-',
        item.spec.target ?? '_self',
        ref ? `${ref.kind}/${ref.name}` : 'custom',
      ])
      visit(node.children, depth + 1)
    }
  }
  visit(tree, 0)
  printTable(['DEPTH', 'NAME', 'DISPLAY NAME', 'HREF', 'TARGET', 'SOURCE'], rows)
}

export function printPluginList(page: Page<Plugin>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'ENABLED', 'VERSION', 'SETTING', 'CONFIG'],
    page.items.map((plugin) => [
      plugin.metadata.name,
      plugin.spec.displayName ?? '-',
      String(plugin.spec.enabled ?? false),
      plugin.spec.version,
      plugin.spec.settingName ? 'yes' : '-',
      plugin.spec.configMapName ? 'yes' : '-',
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个插件\n`)
}

export function printPlugin(plugin: Plugin, json = false): void {
  if (json) {
    printJson(plugin)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', plugin.metadata.name],
    ['Display name', plugin.spec.displayName ?? '-'],
    ['Version', plugin.spec.version],
    ['Enabled', String(plugin.spec.enabled ?? false)],
    ['Phase', String(plugin.status?.phase ?? '-')],
    ['Setting', plugin.spec.settingName ?? '-'],
    ['ConfigMap', plugin.spec.configMapName ?? '-'],
    ['Description', plugin.spec.description ?? '-'],
  ])
}

export function printThemeList(page: Page<Theme>, activeName: string | undefined, json = false): void {
  if (json) {
    printJson({ ...page, active: activeName })
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'ACTIVE', 'VERSION', 'SETTING', 'CONFIG'],
    page.items.map((theme) => [
      theme.metadata.name,
      theme.spec.displayName,
      theme.metadata.name === activeName ? 'yes' : '-',
      theme.spec.version ?? '-',
      theme.spec.settingName ? 'yes' : '-',
      theme.spec.configMapName ? 'yes' : '-',
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个主题\n`)
}

export function printTheme(theme: Theme, activeName: string | undefined, json = false): void {
  if (json) {
    printJson({ ...theme, active: theme.metadata.name === activeName })
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', theme.metadata.name],
    ['Display name', theme.spec.displayName],
    ['Active', String(theme.metadata.name === activeName)],
    ['Version', theme.spec.version ?? '-'],
    ['Phase', String(theme.status?.phase ?? '-')],
    ['Setting', theme.spec.settingName ?? '-'],
    ['ConfigMap', theme.spec.configMapName ?? '-'],
    ['Description', theme.spec.description ?? '-'],
  ])
}

export function printCategoryList(page: Page<Category>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'SLUG', 'POSTS', 'PARENT'],
    page.items.map((category) => [
      category.metadata.name,
      category.spec.displayName,
      category.spec.slug,
      category.status?.postCount ?? 0,
      category.spec.parent ?? '-',
    ]),
  )
}

export function printTagList(page: Page<Tag>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'DISPLAY NAME', 'SLUG', 'POSTS', 'COLOR'],
    page.items.map((tag) => [
      tag.metadata.name,
      tag.spec.displayName,
      tag.spec.slug,
      tag.status?.postCount ?? 0,
      tag.spec.color ?? '-',
    ]),
  )
}

export function printResource(value: Category | Tag, json = false): void {
  if (json) {
    printJson(value)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', value.metadata.name],
    ['Display name', value.spec.displayName],
    ['Slug', value.spec.slug],
    ['Description', value.spec.description ?? '-'],
    ['Posts', value.status?.postCount ?? 0],
    ['Permalink', value.status?.permalink ?? '-'],
  ])
}

export function printExtensionList(page: Page<HaloExtension>, json = false): void {
  if (json) {
    printJson(page)
    return
  }
  printTable(
    ['NAME', 'KIND', 'DISPLAY NAME', 'CREATED'],
    page.items.map((item) => [
      item.metadata.name,
      item.kind,
      extensionDisplayName(item),
      timestamp(item.metadata.creationTimestamp),
    ]),
  )
  process.stdout.write(`第 ${page.page || 1}/${page.totalPages || 1} 页，共 ${page.total} 个资源\n`)
}

export function printExtension(value: HaloExtension, json = false): void {
  if (json) {
    printJson(value)
    return
  }
  printTable(['FIELD', 'VALUE'], [
    ['Name', value.metadata.name],
    ['Kind', value.kind],
    ['API version', value.apiVersion],
    ['Display name', extensionDisplayName(value)],
    ['Created', timestamp(value.metadata.creationTimestamp)],
    ['Deleting', value.metadata.deletionTimestamp ? 'yes' : 'no'],
  ])
}

function extensionDisplayName(value: HaloExtension): string {
  const spec = value.spec
  for (const key of ['displayName', 'title', 'name']) {
    const candidate = spec?.[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return '-'
}
