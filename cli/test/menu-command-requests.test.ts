import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createHaloClient: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  waitForDeletion: vi.fn(),
}))

vi.mock('../src/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client.js')>()),
  createHaloClient: mocks.createHaloClient,
  waitForDeletion: mocks.waitForDeletion,
}))

import { main } from '../src/index.js'

const menu = {
  apiVersion: 'v1alpha1',
  kind: 'Menu',
  metadata: { name: 'primary' },
  spec: { displayName: 'Primary' },
}

const emptyPage = {
  first: true,
  hasNext: false,
  hasPrevious: false,
  items: [],
  last: true,
  page: 0,
  size: 0,
  total: 0,
  totalPages: 0,
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

function connect() {
  mocks.createHaloClient.mockResolvedValue({
    http: {
      delete: mocks.delete,
      get: mocks.get,
      post: mocks.post,
      put: mocks.put,
    },
    name: 'test',
    url: 'https://halo.example',
  })
}

describe('menu command requests', () => {
  it('lists menus with item counts and primary config', async () => {
    connect()
    mocks.get.mockImplementation((path: string) => {
      if (path === '/api/v1alpha1/menus') {
        return Promise.resolve({ data: { ...emptyPage, items: [menu], total: 1 } })
      }
      if (path === '/api/v1alpha1/menuitems') {
        return Promise.resolve({
          data: {
            ...emptyPage,
            items: [{ metadata: { name: 'item-one' }, spec: { menuName: 'primary' } }],
            total: 1,
          },
        })
      }
      if (path === '/apis/console.api.halo.run/v1alpha1/systemconfigs/menu') {
        return Promise.resolve({ data: { primary: 'primary' } })
      }
      throw new Error(`Unexpected GET ${path}`)
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'menu', 'list', '--json'])

    expect(mocks.get).toHaveBeenCalledWith('/api/v1alpha1/menus', { params: { page: 0, size: 0 } })
    expect(mocks.get).toHaveBeenCalledWith('/api/v1alpha1/menuitems', { params: { page: 0, size: 0 } })
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"primary": "primary"'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"primary": 1'))
  })

  it('creates a referenced child before a selected sibling', async () => {
    connect()
    const parent = {
      children: [{ children: [], menuItem: { metadata: { name: 'before-one' }, spec: {} } }],
      menuItem: { metadata: { name: 'parent-one' }, spec: {} },
    }
    mocks.get
      .mockResolvedValueOnce({ data: menu })
      .mockResolvedValueOnce({ data: [parent] })
    mocks.post.mockResolvedValue({
      data: {
        apiVersion: 'v1alpha1',
        kind: 'MenuItem',
        metadata: { name: 'created-item' },
        spec: { menuName: 'primary' },
      },
    })
    mocks.put.mockResolvedValue({ data: [parent] })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'menu',
      'item-create',
      '--menu',
      'primary',
      '--parent',
      'parent-one',
      '--before',
      'before-one',
      '--ref-kind',
      'page',
      '--ref-name',
      'page-one',
      '--json',
    ])

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1alpha1/menuitems',
      expect.objectContaining({
        spec: expect.objectContaining({
          menuName: 'primary',
          parent: 'parent-one',
          priority: 1,
          targetRef: expect.objectContaining({ kind: 'SinglePage', name: 'page-one' }),
        }),
      }),
    )
    expect(mocks.put).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/menuitems/created-item/position',
      { beforeName: 'before-one', menuName: 'primary', parentName: 'parent-one' },
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"name": "created-item"'))
  })

  it('sets the primary menu only after verifying it exists', async () => {
    connect()
    mocks.get.mockResolvedValue({ data: menu })
    mocks.put.mockResolvedValue({ data: undefined })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'menu', 'set-primary', 'primary', '--json'])

    expect(mocks.get).toHaveBeenCalledWith('/api/v1alpha1/menus/primary')
    expect(mocks.put).toHaveBeenCalledWith(
      '/apis/console.api.halo.run/v1alpha1/systemconfigs/menu',
      { primary: 'primary' },
    )
  })

  it('clones a menu tree with remapped parent names', async () => {
    connect()
    const sourceTree = [
      {
        children: [
          {
            children: [],
            menuItem: {
              apiVersion: 'v1alpha1',
              kind: 'MenuItem',
              metadata: { name: 'old-child' },
              spec: { menuName: 'primary', parent: 'old-root', priority: 0 },
            },
          },
        ],
        menuItem: {
          apiVersion: 'v1alpha1',
          kind: 'MenuItem',
          metadata: { name: 'old-root' },
          spec: { menuName: 'primary', priority: 0 },
        },
      },
    ]
    mocks.get.mockResolvedValueOnce({ data: menu }).mockResolvedValueOnce({ data: sourceTree })
    mocks.post
      .mockResolvedValueOnce({ data: { ...menu, metadata: { name: 'menu-copy' } } })
      .mockResolvedValueOnce({ data: { ...sourceTree[0]!.menuItem, metadata: { name: 'new-root' } } })
      .mockResolvedValueOnce({
        data: { ...sourceTree[0]!.children[0]!.menuItem, metadata: { name: 'new-child' } },
      })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'menu', 'clone', 'primary', '--json'])

    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1alpha1/menuitems',
      expect.objectContaining({
        spec: expect.objectContaining({ menuName: 'menu-copy', parent: undefined }),
      }),
    )
    expect(mocks.post).toHaveBeenNthCalledWith(
      3,
      '/api/v1alpha1/menuitems',
      expect.objectContaining({
        spec: expect.objectContaining({ menuName: 'menu-copy', parent: 'new-root' }),
      }),
    )
  })

  it('rolls back the cloned menu and created items after a later clone failure', async () => {
    connect()
    const sourceTree = [
      {
        children: [
          {
            children: [],
            menuItem: {
              apiVersion: 'v1alpha1',
              kind: 'MenuItem',
              metadata: { name: 'old-child' },
              spec: { menuName: 'primary', parent: 'old-root', priority: 0 },
            },
          },
        ],
        menuItem: {
          apiVersion: 'v1alpha1',
          kind: 'MenuItem',
          metadata: { name: 'old-root' },
          spec: { menuName: 'primary', priority: 0 },
        },
      },
    ]
    mocks.get.mockResolvedValueOnce({ data: menu }).mockResolvedValueOnce({ data: sourceTree })
    mocks.post
      .mockResolvedValueOnce({ data: { ...menu, metadata: { name: 'menu-copy' } } })
      .mockResolvedValueOnce({
        data: { ...sourceTree[0]!.menuItem, metadata: { name: 'new-root' } },
      })
      .mockRejectedValueOnce(new Error('child creation failed'))
    mocks.delete.mockResolvedValue({ data: undefined })
    mocks.waitForDeletion.mockResolvedValue(undefined)

    await expect(
      main(['node', 'halo-cli', 'menu', 'clone', 'primary', '--json']),
    ).rejects.toThrow('child creation failed')

    expect(mocks.delete).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/menus/menu-copy',
    )
    expect(mocks.waitForDeletion).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1alpha1/menus/menu-copy',
    )
    expect(mocks.waitForDeletion).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1alpha1/menuitems/new-root',
    )
  })

  it('normalizes CAC empty parent values when moving an item to the root', async () => {
    connect()
    mocks.put.mockResolvedValue({ data: [] })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'menu',
      'item-move',
      'item-one',
      '--menu',
      'primary',
      '--parent',
      '',
      '--before',
      'item-two',
      '--json',
    ])

    expect(mocks.put).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/menuitems/item-one/position',
      { beforeName: 'item-two', menuName: 'primary', parentName: undefined },
    )
  })

  it('deletes menu item descendants before their parent', async () => {
    connect()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    mocks.get
      .mockResolvedValueOnce({ data: { metadata: { name: 'root' }, spec: { menuName: 'primary' } } })
      .mockResolvedValueOnce({
        data: [
          {
            children: [{ children: [], menuItem: { metadata: { name: 'child' }, spec: {} } }],
            menuItem: { metadata: { name: 'root' }, spec: {} },
          },
        ],
      })
    mocks.delete.mockResolvedValue({ data: undefined })
    mocks.waitForDeletion.mockResolvedValue(undefined)

    await main(['node', 'halo-cli', 'menu', 'item-delete', 'root', '--yes', '--json'])

    expect(mocks.delete).toHaveBeenNthCalledWith(1, '/api/v1alpha1/menuitems/child')
    expect(mocks.delete).toHaveBeenNthCalledWith(2, '/api/v1alpha1/menuitems/root')
    expect(mocks.waitForDeletion).toHaveBeenCalledTimes(2)
  })

  it('refuses to delete the active primary menu', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: { primary: 'primary' } })
      .mockResolvedValueOnce({ data: [] })

    await expect(
      main(['node', 'halo-cli', 'menu', 'delete', 'primary', '--yes']),
    ).rejects.toThrow('不能删除当前主菜单')
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('deletes a non-primary menu through the cascading Console endpoint', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: { primary: 'other-menu' } })
      .mockResolvedValueOnce({
        data: [
          {
            children: [{ children: [], menuItem: { metadata: { name: 'child' }, spec: {} } }],
            menuItem: { metadata: { name: 'root' }, spec: {} },
          },
        ],
      })
    mocks.delete.mockResolvedValue({ data: menu })
    mocks.waitForDeletion.mockResolvedValue(undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'menu', 'delete', 'primary', '--yes', '--json'])

    expect(mocks.delete).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/menus/primary',
    )
    expect(mocks.waitForDeletion).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1alpha1/menus/primary',
    )
    expect(mocks.waitForDeletion).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1alpha1/menuitems/child',
    )
    expect(mocks.waitForDeletion).toHaveBeenCalledTimes(3)
  })
})
