import Table from 'cli-table3'

import type {
  Attachment,
  AttachmentGroup,
  Category,
  Comment,
  ContentWrapper,
  ListedComment,
  ListedPost,
  ListedReply,
  ListedSinglePage,
  ListedSnapshot,
  Page,
  Post,
  Reply,
  SinglePage,
  StoragePolicy,
  Tag,
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
