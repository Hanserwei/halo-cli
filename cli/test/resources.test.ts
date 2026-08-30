import { describe, expect, it } from 'vitest'

import {
  consoleAttachmentPath,
  consoleCommentPath,
  consoleMenuItemPath,
  consoleMenuPath,
  consolePostPath,
  consoleReplyPath,
  consoleSinglePagePath,
  menuPath,
  resourcePath,
  storagePath,
  systemConfigPath,
} from '../src/client.js'
import { buildAttachmentPatch } from '../src/commands/attachment.js'
import { buildCategory } from '../src/commands/category.js'
import {
  buildModerationPatch,
  buildReplyRequest,
  normalizeSubjectRef,
} from '../src/commands/comment.js'
import {
  buildCreateSinglePageRequest,
  buildUpdateSinglePageRequest,
  ensureSnapshotCanRevert,
  pagePhase,
  pageVisibility,
} from '../src/commands/page.js'
import { buildCreatePostRequest, buildUpdatePostRequest } from '../src/commands/post.js'
import { buildTag } from '../src/commands/tag.js'
import type { Attachment, Post, SinglePage } from '../src/types.js'

const currentPost: Post = {
  apiVersion: 'content.halo.run/v1alpha1',
  kind: 'Post',
  metadata: { name: 'post-one', version: 3 },
  spec: {
    allowComment: true,
    categories: ['category-old'],
    deleted: false,
    excerpt: { autoGenerate: true },
    pinned: false,
    priority: 0,
    publish: false,
    slug: 'old-title',
    tags: ['tag-old'],
    title: 'Old title',
    visible: 'PUBLIC',
  },
}

const currentPage: SinglePage = {
  apiVersion: 'content.halo.run/v1alpha1',
  kind: 'SinglePage',
  metadata: { name: 'page-one', version: 2 },
  spec: {
    allowComment: true,
    deleted: false,
    excerpt: { autoGenerate: true },
    pinned: false,
    priority: 0,
    publish: false,
    slug: 'about',
    title: 'About',
    visible: 'PUBLIC',
  },
}

const currentAttachment: Attachment = {
  apiVersion: 'storage.halo.run/v1alpha1',
  kind: 'Attachment',
  metadata: { name: 'attachment-one' },
  spec: { displayName: 'old.png', groupName: 'group-old', tags: ['old'] },
}

describe('Halo resources', () => {
  it('uses the Halo 2.26 resource and Console API paths', () => {
    expect(resourcePath('posts', 'hello/world')).toBe(
      '/apis/content.halo.run/v1alpha1/posts/hello%2Fworld',
    )
    expect(consolePostPath('hello/world', 'publish')).toBe(
      '/apis/api.console.halo.run/v1alpha1/posts/hello%2Fworld/publish',
    )
    expect(resourcePath('singlepages', 'about/me')).toBe(
      '/apis/content.halo.run/v1alpha1/singlepages/about%2Fme',
    )
    expect(consoleSinglePagePath('about/me', 'head-content')).toBe(
      '/apis/api.console.halo.run/v1alpha1/singlepages/about%2Fme/head-content',
    )
    expect(consoleCommentPath('comment/one', 'reply')).toBe(
      '/apis/api.console.halo.run/v1alpha1/comments/comment%2Fone/reply',
    )
    expect(consoleReplyPath()).toBe('/apis/api.console.halo.run/v1alpha1/replies')
    expect(consoleAttachmentPath('-/upload-from-url')).toBe(
      '/apis/api.console.halo.run/v1alpha1/attachments/-/upload-from-url',
    )
    expect(storagePath('attachments', 'image/one')).toBe(
      '/apis/storage.halo.run/v1alpha1/attachments/image%2Fone',
    )
    expect(menuPath('menus', 'main/menu')).toBe('/api/v1alpha1/menus/main%2Fmenu')
    expect(menuPath('menuitems', 'item/one')).toBe('/api/v1alpha1/menuitems/item%2Fone')
    expect(consoleMenuPath('main/menu')).toBe(
      '/apis/api.console.halo.run/v1alpha1/menus/main%2Fmenu',
    )
    expect(consoleMenuItemPath('item/one', 'position')).toBe(
      '/apis/api.console.halo.run/v1alpha1/menuitems/item%2Fone/position',
    )
    expect(systemConfigPath('menu/group')).toBe(
      '/apis/console.api.halo.run/v1alpha1/systemconfigs/menu%2Fgroup',
    )
  })

  it('builds a draft post with rendered Markdown', async () => {
    const request = await buildCreatePostRequest({
      categories: 'category-a,category-b',
      content: '# Hello',
      publish: true,
      tags: 'tag-a',
      title: 'Hello Halo',
    })

    expect(request.post.spec).toMatchObject({
      categories: ['category-a', 'category-b'],
      publish: false,
      slug: 'hello-halo',
      tags: ['tag-a'],
      title: 'Hello Halo',
    })
    expect(request.content).toMatchObject({ raw: '# Hello', rawType: 'markdown' })
    expect(request.content.content).toContain('<h1>Hello</h1>')
  })

  it('preserves leading whitespace in post and page content', async () => {
    const post = await buildCreatePostRequest({ content: '    code\n', title: 'Code' })
    const page = await buildCreateSinglePageRequest({ content: '    page code\n', title: 'Page' })

    expect(post.content.raw).toBe('    code\n')
    expect(post.content.content).toContain('<pre><code>code')
    expect(page.content.raw).toBe('    page code\n')
    expect(page.content.content).toContain('<pre><code>page code')
  })

  it('updates selected post fields while preserving server metadata', async () => {
    const request = await buildUpdatePostRequest(
      currentPost,
      { content: '<p>Old</p>', raw: 'Old', rawType: 'markdown' },
      { categories: '', content: 'New', title: 'New title' },
    )

    expect(request.post.metadata).toEqual({ name: 'post-one', version: 3 })
    expect(request.post.spec.categories).toEqual([])
    expect(request.post.spec.tags).toEqual(['tag-old'])
    expect(request.post.spec.title).toBe('New title')
    expect(request.content.content).toContain('<p>New</p>')
  })

  it('builds and updates single pages with separate rendered content', async () => {
    const created = await buildCreateSinglePageRequest({
      content: '# About',
      title: '关于 我们',
      visible: 'internal',
    })
    expect(created.page.spec).toMatchObject({
      publish: false,
      slug: '关于-我们',
      title: '关于 我们',
      visible: 'INTERNAL',
    })
    expect(created.content.content).toContain('<h1>About</h1>')

    const updated = await buildUpdateSinglePageRequest(
      currentPage,
      { content: '<p>Old</p>', raw: 'Old', rawType: 'markdown' },
      { allowComment: 'false', content: 'New', title: 'New page' },
    )
    expect(updated.page.metadata).toEqual({ name: 'page-one', version: 2 })
    expect(updated.page.spec).toMatchObject({ allowComment: false, slug: 'about', title: 'New page' })
    expect(updated.content.content).toContain('<p>New</p>')
  })

  it('builds moderation and reply request payloads', () => {
    expect(buildModerationPatch(true, new Date('2026-01-02T03:04:05Z'))).toEqual([
      { op: 'add', path: '/spec/approved', value: true },
      { op: 'add', path: '/spec/approvedTime', value: '2026-01-02T03:04:05.000Z' },
    ])
    expect(buildModerationPatch(false)).toEqual([
      { op: 'add', path: '/spec/approved', value: false },
      { op: 'add', path: '/spec/approvedTime', value: '' },
    ])
    expect(
      buildReplyRequest({
        allowNotification: 'false',
        content: 'Thanks',
        hidden: 'true',
        quote: 'reply-one',
      }),
    ).toEqual({
      allowNotification: false,
      content: 'Thanks',
      hidden: true,
      quoteReply: 'reply-one',
      raw: 'Thanks',
    })
    expect(buildReplyRequest({ content: 'Default notification' })).toMatchObject({
      allowNotification: true,
      content: 'Default notification',
      raw: 'Default notification',
    })
    expect(buildReplyRequest({ content: '  indented reply\n' }).raw).toBe('  indented reply\n')
  })

  it('normalizes three-component comment subject references', () => {
    expect(normalizeSubjectRef(' content.halo.run / Post / post-one ')).toBe(
      'content.halo.run/Post/post-one',
    )
    expect(() => normalizeSubjectRef('content.halo.run/v1alpha1/Post/post-one')).toThrow(
      'group/kind/name',
    )
    expect(() => normalizeSubjectRef('content.halo.run//post-one')).toThrow('不能为空')
  })

  it('builds attachment metadata patches including ungrouping and tag clearing', () => {
    expect(
      buildAttachmentPatch(currentAttachment, {
        displayName: 'new.png',
        group: '',
        tags: '',
      }),
    ).toEqual([
      { op: 'add', path: '/spec/displayName', value: 'new.png' },
      { op: 'remove', path: '/spec/groupName' },
      { op: 'add', path: '/spec/tags', value: [] },
    ])
    expect(() => buildAttachmentPatch(currentAttachment, {})).toThrow('至少提供')
  })

  it('validates and normalizes page list filters', () => {
    expect(pagePhase(' published ')).toBe('PUBLISHED')
    expect(pageVisibility(' internal ', 'PUBLIC')).toBe('INTERNAL')
    expect(() => pagePhase('scheduled')).toThrow('--phase')
    expect(() => pageVisibility('members', 'PUBLIC')).toThrow('--visible')
  })

  it('rejects reverting the page to its current head snapshot', () => {
    const page = {
      ...currentPage,
      spec: { ...currentPage.spec, headSnapshot: 'snapshot-current' },
    }
    expect(() => ensureSnapshotCanRevert(page, 'snapshot-current')).toThrow('page publish')
    expect(() => ensureSnapshotCanRevert(page, 'snapshot-history')).not.toThrow()
  })

  it('builds category and tag payloads with generated names and slugs', () => {
    expect(buildCategory({ displayName: '开发 笔记', priority: '10' })).toMatchObject({
      metadata: { generateName: 'category-' },
      spec: { displayName: '开发 笔记', priority: 10, slug: '开发-笔记' },
    })
    expect(buildTag({ color: '#1890ff', displayName: 'Halo CLI' })).toMatchObject({
      metadata: { generateName: 'tag-' },
      spec: { color: '#1890ff', displayName: 'Halo CLI', slug: 'halo-cli' },
    })
    expect(() => buildTag({ color: 'red', displayName: 'Invalid' })).toThrow('标签颜色')
  })
})
