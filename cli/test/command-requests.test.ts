import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createHaloClient: vi.fn(),
  get: vi.fn(),
}))

vi.mock('../src/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client.js')>()),
  createHaloClient: mocks.createHaloClient,
}))

import { main } from '../src/index.js'

const emptyPage = {
  first: true,
  hasNext: false,
  hasPrevious: false,
  items: [],
  last: true,
  page: 1,
  size: 20,
  total: 0,
  totalPages: 0,
}

afterEach(() => {
  vi.restoreAllMocks()
  mocks.createHaloClient.mockReset()
  mocks.get.mockReset()
})

describe('phase-two command requests', () => {
  it('sends normalized page filters and prints the API page as JSON', async () => {
    mocks.get.mockResolvedValue({ data: emptyPage })
    mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get }, name: 'test', url: 'https://halo.example' })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'page',
      'list',
      '--phase',
      ' published ',
      '--visible',
      ' internal ',
      '--json',
    ])

    expect(mocks.get).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/singlepages',
      expect.objectContaining({
        params: expect.objectContaining({ publishPhase: 'PUBLISHED', visible: 'INTERNAL' }),
      }),
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"items": []'))
  })

  it('prints page metadata followed by the raw draft body', async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: {
          apiVersion: 'content.halo.run/v1alpha1',
          kind: 'SinglePage',
          metadata: { name: 'page-one' },
          spec: {
            allowComment: true,
            deleted: false,
            excerpt: { autoGenerate: true },
            pinned: false,
            priority: 0,
            publish: false,
            slug: 'page-one',
            title: 'Page one',
            visible: 'PUBLIC',
          },
        },
      })
      .mockResolvedValueOnce({ data: { raw: '  raw draft\n', rawType: 'markdown' } })
    mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get }, name: 'test', url: 'https://halo.example' })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'page', 'get', 'page-one'])

    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/apis/content.halo.run/v1alpha1/singlepages/page-one',
    )
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/apis/api.console.halo.run/v1alpha1/singlepages/page-one/head-content',
    )
    expect(output).toHaveBeenCalledWith('\n  raw draft\n\n')
  })

  it('normalizes comment subject refs before sending the field selector', async () => {
    mocks.get.mockResolvedValue({ data: emptyPage })
    mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get }, name: 'test', url: 'https://halo.example' })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'comment',
      'list',
      '--subject',
      ' content.halo.run / Post / post-one ',
      '--json',
    ])

    expect(mocks.get).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/comments',
      expect.objectContaining({
        params: expect.objectContaining({
          fieldSelector: ['spec.subjectRef=content.halo.run/Post/post-one'],
        }),
      }),
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"total": 0'))
  })

  it('rejects malformed subject refs before creating a Halo client', async () => {
    await expect(
      main([
        'node',
        'halo-cli',
        'comment',
        'list',
        '--subject',
        'content.halo.run/v1alpha1/Post/post-one',
        '--json',
      ]),
    ).rejects.toThrow('group/kind/name')

    expect(mocks.createHaloClient).not.toHaveBeenCalled()
  })

  it('passes attachment policy pagination and prints JSON', async () => {
    mocks.get.mockResolvedValue({ data: { ...emptyPage, page: 3, size: 7 } })
    mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get }, name: 'test', url: 'https://halo.example' })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'attachment',
      'policies',
      '--page',
      '3',
      '--size',
      '7',
      '--json',
    ])

    expect(mocks.get).toHaveBeenCalledWith('/apis/storage.halo.run/v1alpha1/policies', {
      params: { page: 3, size: 7 },
    })
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"page": 3'))
  })
})
