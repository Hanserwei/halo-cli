import { describe, expect, it } from 'vitest'

import { consolePostPath, resourcePath } from '../src/client.js'
import { buildCategory } from '../src/commands/category.js'
import { buildCreatePostRequest, buildUpdatePostRequest } from '../src/commands/post.js'
import { buildTag } from '../src/commands/tag.js'
import type { Post } from '../src/types.js'

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

describe('Halo resources', () => {
  it('uses the Halo 2.26 resource and Console API paths', () => {
    expect(resourcePath('posts', 'hello/world')).toBe(
      '/apis/content.halo.run/v1alpha1/posts/hello%2Fworld',
    )
    expect(consolePostPath('hello/world', 'publish')).toBe(
      '/apis/api.console.halo.run/v1alpha1/posts/hello%2Fworld/publish',
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
