import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ClientModule from '../src/client.js'

const mocks = vi.hoisted(() => ({
  createHaloClient: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('../src/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  createHaloClient: mocks.createHaloClient,
}))

import { main } from '../src/index.js'

const basePath = '/apis/console.api.mail-template.halo.run/v1alpha1'
const detail = {
  customized: false,
  reasonType: { metadata: { name: 'new-comment' }, spec: { displayName: '新评论' } },
  template: {
    apiVersion: 'notification.halo.run/v1alpha1',
    kind: 'NotificationTemplate',
    metadata: { name: 'default-comment', version: 3 },
    spec: {
      reasonSelector: { reasonType: 'new-comment', language: 'default' },
      template: { title: 'New comment', htmlBody: '<p>Comment</p>', rawBody: 'Comment' },
    },
  },
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-mail-test-'))
  mocks.createHaloClient.mockResolvedValue({
    http: { delete: mocks.delete, get: mocks.get, post: mocks.post, put: mocks.put },
    name: 'test',
    url: 'https://halo.example',
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
  await rm(directory, { force: true, recursive: true })
})

describe('mail template commands', () => {
  it('queries the maintained plugin endpoint with pagination', async () => {
    mocks.get.mockResolvedValue({ data: { page: 2, size: 7, total: 1, items: [detail] } })

    await main(['node', 'halo-cli', 'mail-template', 'list', '--page', '2', '--size', '7', '--json'])

    expect(mocks.get).toHaveBeenCalledWith(`${basePath}/mailtemplates`, { params: { page: 2, size: 7 } })
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('new-comment'))
  })

  it('exports an effective template and imports only editable fields', async () => {
    const file = join(directory, 'template.json')
    mocks.get.mockResolvedValue({ data: detail })
    mocks.put.mockResolvedValue({ data: { ...detail, customized: true } })

    await main(['node', 'halo-cli', 'mail-template', 'export', 'new-comment', '--output', file])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(detail)
    await main(['node', 'halo-cli', 'mail-template', 'import', 'new-comment', '--file', file, '--json'])

    expect(mocks.put).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment`, {
      title: 'New comment', htmlBody: '<p>Comment</p>', rawBody: 'Comment', language: 'default',
    })
  })

  it('preserves omitted fields and reads empty bodies deliberately', async () => {
    const file = join(directory, 'empty.txt')
    await writeFile(file, '')
    mocks.put.mockResolvedValue({ data: detail })

    await main(['node', 'halo-cli', 'mail-template', 'update', 'new-comment', '--raw-file', file, '--json'])

    expect(mocks.put).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment`, { rawBody: '' })
  })

  it('overrides imported fields only when explicitly supplied', async () => {
    const file = join(directory, 'fields.json')
    await writeFile(file, JSON.stringify({ title: 'Imported', htmlBody: '<p>Keep</p>' }))
    mocks.put.mockResolvedValue({ data: detail })

    await main(['node', 'halo-cli', 'mail-template', 'update', 'new-comment', '--file', file, '--title', 'Updated', '--json'])

    expect(mocks.put).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment`, {
      title: 'Updated', htmlBody: '<p>Keep</p>',
    })
  })

  it('validates unsaved changes without persisting or sending mail', async () => {
    mocks.post.mockResolvedValue({ data: { valid: true } })

    await main(['node', 'halo-cli', 'mail-template', 'validate', 'new-comment', '--title', 'Preview', '--json'])

    expect(mocks.post).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment/validate`, { title: 'Preview' })
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('validates the current template without requiring update fields', async () => {
    mocks.post.mockResolvedValue({ data: { valid: true } })

    await main(['node', 'halo-cli', 'mail-template', 'validate', 'new-comment', '--json'])

    expect(mocks.post).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment/validate`, {})
  })

  it('requires explicit confirmation before restoring a template or sending mail', async () => {
    for (const command of ['restore', 'verify']) {
      await expect(main(['node', 'halo-cli', 'mail-template', command, 'new-comment'])).rejects.toThrow('--yes')
    }
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('restores only the selected override and reports a mail submission', async () => {
    mocks.delete.mockResolvedValue({ status: 204 })
    mocks.post.mockResolvedValue({ status: 202 })

    await main(['node', 'halo-cli', 'mail-template', 'restore', 'new-comment', '--yes', '--json'])
    await main(['node', 'halo-cli', 'mail-template', 'verify', 'new-comment', '--yes', '--json'])

    expect(mocks.delete).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment`)
    expect(mocks.post).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment/verify-send`)
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('"submitted": true'))
  })

  it('rejects an empty update, unsupported imported fields and invalid input before requests', async () => {
    const file = join(directory, 'invalid.json')
    await writeFile(file, JSON.stringify({ ownerName: 'other-user' }))

    await expect(main(['node', 'halo-cli', 'mail-template', 'update', 'new-comment'])).rejects.toThrow('至少提供')
    await expect(main(['node', 'halo-cli', 'mail-template', 'update', 'new-comment', '--file', file])).rejects.toThrow('不支持的字段')
    await expect(main(['node', 'halo-cli', 'mail-template', 'get', '../keys'])).rejects.toThrow('metadata.name')
    await expect(main(['node', 'halo-cli', 'mail-template', 'list', '--size', '101'])).rejects.toThrow('100')
    await expect(main(['node', 'halo-cli', 'mail-template', 'update', 'new-comment', '--language', ''])).rejects.toThrow('语言')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
  })

  it('allows the same nonblank private language tags as the plugin API', async () => {
    mocks.post.mockResolvedValue({ data: { valid: true } })
    await main(['node', 'halo-cli', 'mail-template', 'validate', 'new-comment', '--language', 'x-private', '--json'])
    expect(mocks.post).toHaveBeenCalledWith(`${basePath}/mailtemplates/new-comment/validate`, { language: 'x-private' })
  })

  it('queries system properties through the maintained plugin API', async () => {
    mocks.get.mockResolvedValue({ data: { items: [{ name: 'site.title' }] } })

    await main(['node', 'halo-cli', 'mail-template', 'properties', '--json'])

    expect(mocks.get).toHaveBeenCalledWith(`${basePath}/system-properties`)
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('site.title'))
  })
})
