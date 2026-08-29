import Table from 'cli-table3'

import type { Category, ListedPost, Page, Post, Tag } from './types.js'

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
