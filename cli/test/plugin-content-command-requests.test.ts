import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '../src/client.js'

const mocks = vi.hoisted(() => ({ createHaloClient: vi.fn(), get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('../src/client.js', async (original) => ({ ...(await original<typeof ClientModule>()), createHaloClient: mocks.createHaloClient }))
import { main } from '../src/index.js'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-plugin-content-'))
  mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get, put: mocks.put, post: mocks.post }, name: 'test', url: 'https://halo.example' })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  Object.values(mocks).forEach((mock) => mock.mockReset())
  await rm(directory, { recursive: true, force: true })
})

describe('plugin content list requests', () => {
  it('uses the equipment Console endpoint for keyword filtering and pagination', async () => {
    mocks.get.mockResolvedValue({ data: { items: [], total: 0 } })
    await main(['node', 'halo-cli', 'equipment', 'list', '--keyword', '工作设备', '--page', '2', '--size', '5', '--json'])
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/apis/console.api.equipment.hanserwei.github.io/v1alpha1/equipments', {
      params: { page: 2, size: 5, keyword: '工作设备' },
    })
  })

  it.each([
    ['equipment', '/apis/equipment.hanserwei.github.io/v1alpha1/equipmentgroups'],
    ['photo', '/apis/core.halo.run/v1alpha1/photogroups'],
    ['link', '/apis/core.halo.run/v1alpha1/linkgroups'],
  ])('preserves the ordinary %s groups request', async (command, path) => {
    mocks.get.mockResolvedValue({ data: { items: [] } })
    await main(['node', 'halo-cli', command, 'groups', '--page', '2', '--size', '5', '--json'])
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(path, { params: { page: 2, size: 5, keyword: undefined } })
  })

  it.each(['equipment', 'photo', 'link'])('rejects keyword filtering for %s groups before connecting', async (command) => {
    await expect(main(['node', 'halo-cli', command, 'groups', '--keyword', 'ignored', '--json'])).rejects.toThrow('不支持 --keyword')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it.each([
    ['moment', '/apis/console.api.moment.halo.run/v1alpha1/moments'],
    ['photo', '/apis/console.api.photo.halo.run/v1alpha1/photos'],
    ['link', '/apis/console.api.link.halo.run/v1alpha1/links'],
  ])('keeps the %s keyword list request unchanged', async (command, path) => {
    mocks.get.mockResolvedValue({ data: { items: [] } })
    await main(['node', 'halo-cli', command, 'list', '--keyword', 'Hello', '--json'])
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(path, { params: { page: 1, size: 20, keyword: 'Hello' } })
  })
})

describe('moment create owner semantics', () => {
  it('sends no owner and returns the owner selected by the Console service', async () => {
    mocks.post.mockResolvedValue({ data: { spec: { owner: 'authenticated-user' } } })
    await main(['node', 'halo-cli', 'moment', 'create', '--content', '# Hello', '--visible', 'PRIVATE', '--json'])
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/apis/console.api.moment.halo.run/v1alpha1/moments', {
      apiVersion: 'moment.halo.run/v1alpha1', kind: 'Moment', metadata: { generateName: 'moment-' },
      spec: { content: { raw: '# Hello', html: '<h1>Hello</h1>\n' }, visible: 'PRIVATE' },
    })
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('authenticated-user'))
  })

  it('previews creation without an owner and identifies the current-user ownership rule', async () => {
    await main(['node', 'halo-cli', 'moment', 'create', '--content', 'Hello', '--dry-run', '--json'])
    const output = vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0]
    const result = JSON.parse(String(output))
    expect(result.dryRun).toBe(true)
    expect(result.resource.spec).not.toHaveProperty('owner')
    expect(result.note).toContain('当前登录用户')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects --owner before connecting (dry-run: %s)', async (dryRun) => {
    await expect(main(['node', 'halo-cli', 'moment', 'create', '--owner', 'pretend-user', '--content', 'Hello', ...(dryRun ? ['--dry-run'] : []), '--json']))
      .rejects.toThrow('owner 由服务端设为当前登录用户')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects owner in --spec, including null (dry-run: %s)', async (dryRun) => {
    for (const owner of ['pretend-user', null]) {
      await expect(main(['node', 'halo-cli', 'moment', 'create', '--spec', JSON.stringify({ content: { raw: 'Hello' }, owner }), ...(dryRun ? ['--dry-run'] : []), '--json']))
        .rejects.toThrow('请移除 --owner 或 spec.owner')
    }
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects owner in an existing resource JSON file (dry-run: %s)', async (dryRun) => {
    const file = join(directory, 'existing-moment.json')
    await writeFile(file, JSON.stringify({
      apiVersion: 'moment.halo.run/v1alpha1', kind: 'Moment', metadata: { name: 'existing-moment', version: 2 },
      spec: { content: { raw: 'Hello' }, owner: 'original-owner' },
    }))
    await expect(main(['node', 'halo-cli', 'moment', 'create', '--file', file, ...(dryRun ? ['--dry-run'] : []), '--json']))
      .rejects.toThrow('请移除 --owner 或 spec.owner')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('keeps owner updates on the existing resource endpoint', async () => {
    const current = {
      apiVersion: 'moment.halo.run/v1alpha1', kind: 'Moment', metadata: { name: 'moment-one', version: 2 },
      spec: { content: { raw: 'Hello' }, owner: 'original-owner', tags: ['keep'] },
    }
    mocks.get.mockResolvedValue({ data: current })
    mocks.put.mockImplementation(async (_path, payload) => ({ data: payload }))
    await main(['node', 'halo-cli', 'moment', 'update', 'moment-one', '--owner', 'new-owner', '--json'])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/apis/moment.halo.run/v1alpha1/moments/moment-one', {
      ...current, spec: { ...current.spec, owner: 'new-owner' },
    })
  })
})
