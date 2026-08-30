import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createHaloClient: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  request: vi.fn(),
}))

vi.mock('../src/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client.js')>()),
  createHaloClient: mocks.createHaloClient,
}))

import { main } from '../src/index.js'

function connect() {
  mocks.createHaloClient.mockResolvedValue({
    http: {
      delete: mocks.delete,
      get: mocks.get,
      patch: mocks.patch,
      post: mocks.post,
      put: mocks.put,
      request: mocks.request,
    },
    name: 'test',
    url: 'https://halo.example',
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('extension commands', () => {
  it('creates a known plugin resource from spec and annotations', async () => {
    connect()
    mocks.post.mockResolvedValue({
      data: {
        apiVersion: 'core.halo.run/v1alpha1',
        kind: 'LinkGroup',
        metadata: { name: 'link-group-one' },
        spec: { displayName: 'Friends' },
      },
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'extension',
      'create',
      'link-group',
      '--spec',
      '{"displayName":"Friends","priority":1}',
      '--annotations',
      '{"displayStyle":"beautify"}',
      '--json',
    ])

    expect(mocks.post).toHaveBeenCalledWith(
      '/apis/core.halo.run/v1alpha1/linkgroups',
      expect.objectContaining({
        apiVersion: 'core.halo.run/v1alpha1',
        kind: 'LinkGroup',
        metadata: expect.objectContaining({
          annotations: { displayStyle: 'beautify' },
          generateName: 'link-group-',
        }),
        spec: { displayName: 'Friends', priority: 1 },
      }),
    )
  })

  it('updates one extension field with JSON Pointer', async () => {
    connect()
    const current = {
      apiVersion: 'core.halo.run/v1alpha1',
      kind: 'Link',
      metadata: { name: 'link-one', version: 3 },
      spec: { displayName: 'Old', url: 'https://example.test' },
    }
    mocks.get.mockResolvedValue({ data: current })
    mocks.put.mockImplementation(async (_path, payload) => ({ data: payload }))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'extension',
      'set',
      'link',
      'link-one',
      '/metadata/annotations/labelColor',
      '"#425AEF"',
      '--json',
    ])

    expect(mocks.put).toHaveBeenCalledWith(
      '/apis/core.halo.run/v1alpha1/links/link-one',
      expect.objectContaining({
        metadata: expect.objectContaining({ annotations: { labelColor: '#425AEF' } }),
      }),
    )
  })

  it('merges arrays and numbers into extension spec updates', async () => {
    connect()
    const current = {
      apiVersion: 'moment.halo.run/v1alpha1',
      kind: 'Moment',
      metadata: { name: 'moment-one', version: 2 },
      spec: { content: { raw: 'Hello' }, tags: ['old'], visible: 'PUBLIC' },
    }
    mocks.get.mockResolvedValue({ data: current })
    mocks.put.mockImplementation(async (_path, payload) => ({ data: payload }))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'extension',
      'update',
      'moment',
      'moment-one',
      '--spec',
      '{"tags":["new"],"priority":3}',
      '--json',
    ])

    expect(mocks.put).toHaveBeenCalledWith(
      '/apis/moment.halo.run/v1alpha1/moments/moment-one',
      expect.objectContaining({
        spec: {
          content: { raw: 'Hello' },
          priority: 3,
          tags: ['new'],
          visible: 'PUBLIC',
        },
      }),
    )
  })
})

describe('API and search commands', () => {
  it('calls a same-site plugin API and redacts the response', async () => {
    connect()
    mocks.request.mockResolvedValue({ data: { apiKey: 'secret', ok: true }, status: 200 })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'api',
      'request',
      'GET',
      '/apis/api.plugin.halo.run/v1alpha1/plugins/plugin-afdian/afdian/config',
      '--query',
      '{"refresh":true}',
      '--json',
    ])

    expect(mocks.request).toHaveBeenCalledWith({
      data: undefined,
      method: 'GET',
      params: { refresh: true },
      url: '/apis/api.plugin.halo.run/v1alpha1/plugins/plugin-afdian/afdian/config',
    })
    expect(output).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'))
  })

  it('rejects external API URLs before creating a client', async () => {
    await expect(
      main(['node', 'halo-cli', 'api', 'request', 'GET', 'https://evil.example/apis/data']),
    ).rejects.toThrow('当前 Halo 站点')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
  })

  it('queries the Halo search index', async () => {
    connect()
    mocks.post.mockResolvedValue({
      data: { hits: [], keyword: 'Halo', limit: 5, processingTimeMillis: 1, total: 0 },
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'search', 'query', 'Halo', '--limit', '5', '--json'])

    expect(mocks.post).toHaveBeenCalledWith(
      '/apis/api.halo.run/v1alpha1/indices/-/search',
      expect.objectContaining({ keyword: 'Halo', limit: 5 }),
    )
  })

  it('uploads multipart files to a same-site plugin API', async () => {
    connect()
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-api-upload-'))
    const file = join(directory, 'photo.jpg')
    await writeFile(file, 'image')
    mocks.post.mockResolvedValue({ data: { metadata: { name: 'photo-one' } }, status: 201 })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      await main([
        'node',
        'halo-cli',
        'api',
        'upload',
        '/apis/console.api.photo.halo.run/v1alpha1/photos/upload',
        '--file',
        file,
        '--form',
        '{"group":"photo-group-one"}',
        '--json',
      ])
    } finally {
      await rm(directory, { recursive: true })
    }

    expect(mocks.post).toHaveBeenCalledWith(
      '/apis/console.api.photo.halo.run/v1alpha1/photos/upload',
      expect.any(FormData),
      { params: undefined },
    )
    const form = mocks.post.mock.calls[0]?.[1] as FormData
    expect(form.get('group')).toBe('photo-group-one')
    expect((form.get('file') as File).name).toBe('photo.jpg')
  })
})

describe('Hao compatibility commands', () => {
  it('reports installed, missing, and active capabilities', async () => {
    connect()
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/apis/api.console.halo.run/v1alpha1/plugins') {
        return {
          data: {
            items: [
              {
                metadata: { name: 'PluginLinks' },
                spec: { displayName: 'Links', enabled: true, version: '2.3.0' },
              },
            ],
          },
        }
      }
      if (path === '/apis/api.console.halo.run/v1alpha1/themes/-/activation') {
        return { data: { metadata: { name: 'theme-hao' }, spec: { version: '1.7.3' } } }
      }
      if (path === '/apis/theme.halo.run/v1alpha1/themes/theme-hao') {
        return {
          data: {
            metadata: { name: 'theme-hao' },
            spec: { customTemplates: { page: [{ file: 'about.html', name: '关于' }] }, version: '1.7.3' },
          },
        }
      }
      throw new Error(`Unexpected GET ${path}`)
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'hao', 'doctor', '--json'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"compatible": true'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('hybrid-edit-block'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('about.html'))
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]))
    expect(result.plugins).toContainEqual(
      expect.objectContaining({ name: 'PluginFeed', optional: true }),
    )
    expect(result.warnings).not.toContain(expect.stringContaining('PluginFeed'))
  })
})
