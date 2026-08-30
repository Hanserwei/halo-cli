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

const plugin = {
  apiVersion: 'plugin.halo.run/v1alpha1',
  kind: 'Plugin',
  metadata: { name: 'plugin-example' },
  spec: {
    configMapName: 'config-plugin-example',
    description: 'Example plugin',
    displayName: 'Example Plugin',
    enabled: true,
    settingName: 'setting-plugin-example',
    version: '1.2.3',
  },
}

const theme = {
  apiVersion: 'theme.halo.run/v1alpha1',
  kind: 'Theme',
  metadata: { name: 'theme-example' },
  spec: {
    configMapName: 'config-theme-example',
    description: 'Example theme',
    displayName: 'Example Theme',
    settingName: 'setting-theme-example',
    version: '2.0.0',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  mocks.createHaloClient.mockReset()
  mocks.get.mockReset()
})

function connect() {
  mocks.createHaloClient.mockResolvedValue({
    http: { get: mocks.get },
    name: 'test',
    url: 'https://halo.example',
  })
}

describe('plugin and theme configuration requests', () => {
  it('discovers plugins through the Console list endpoint', async () => {
    connect()
    mocks.get.mockResolvedValue({ data: { ...emptyPage, items: [plugin], total: 1 } })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'plugin',
      'list',
      '--page',
      '2',
      '--size',
      '7',
      '--keyword',
      'example',
      '--enabled',
      'true',
      '--json',
    ])

    expect(mocks.get).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/plugins',
      { params: { enabled: true, keyword: 'example', page: 2, size: 7 } },
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('plugin-example'))
  })

  it('reads a plugin schema after checking its declared setting', async () => {
    connect()
    mocks.get.mockResolvedValueOnce({ data: plugin }).mockResolvedValueOnce({
      data: { apiVersion: 'v1alpha1', kind: 'Setting', metadata: { name: 'setting-plugin-example' }, spec: { forms: [] } },
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'plugin', 'setting', 'plugin-example', '--json'])

    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/apis/plugin.halo.run/v1alpha1/plugins/plugin-example',
    )
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/apis/api.console.halo.run/v1alpha1/plugins/plugin-example/setting',
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"forms": []'))
  })

  it('reads and redacts plugin config by default', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: plugin })
      .mockResolvedValueOnce({ data: { endpoint: 'https://example.test', apiKey: 'secret' } })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'plugin', 'config', 'plugin-example', '--json'])

    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/apis/api.console.halo.run/v1alpha1/plugins/plugin-example/json-config',
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"apiKey": "[REDACTED]"'))
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('secret'))
  })

  it('exports an explicit unredacted plugin config only to a file', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: plugin })
      .mockResolvedValueOnce({ data: { clientSecret: 'secret', endpoint: 'https://example.test' } })
    const directory = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/halo-cli-plugin-export-'))
    const outputPath = `${directory}/plugin.json`
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main([
      'node',
      'halo-cli',
      'plugin',
      'config-export',
      'plugin-example',
      '--output',
      outputPath,
      '--include-secrets',
      '--json',
    ])

    const exported = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(outputPath, 'utf8')))
    expect(exported).toEqual({ clientSecret: 'secret', endpoint: 'https://example.test' })
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"redacted": false'))
    await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true }))
  })

  it('discovers the current theme through Halo activation endpoint', async () => {
    connect()
    mocks.get.mockResolvedValue({ data: theme })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'theme', 'current', '--json'])

    expect(mocks.get).toHaveBeenCalledWith(
      '/apis/api.console.halo.run/v1alpha1/themes/-/activation',
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('theme-example'))
  })

  it('lists themes and marks the activated theme', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: { ...emptyPage, items: [theme], total: 1 } })
      .mockResolvedValueOnce({ data: theme })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'theme', 'list', '--json'])

    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/apis/api.console.halo.run/v1alpha1/themes',
      { params: { page: 1, size: 50, uninstalled: undefined } },
    )
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/apis/api.console.halo.run/v1alpha1/themes/-/activation',
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"active": "theme-example"'))
  })

  it('reads and redacts theme config through the Console endpoint', async () => {
    connect()
    mocks.get
      .mockResolvedValueOnce({ data: theme })
      .mockResolvedValueOnce({ data: { siteTitle: 'Halo', clientToken: 'secret' } })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['node', 'halo-cli', 'theme', 'config', 'theme-example', '--json'])

    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/apis/theme.halo.run/v1alpha1/themes/theme-example',
    )
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/apis/api.console.halo.run/v1alpha1/themes/theme-example/json-config',
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"clientToken": "[REDACTED]"'))
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('secret'))
  })

  it('rejects schema lookup when a plugin has no declared setting', async () => {
    connect()
    mocks.get.mockResolvedValue({ data: { ...plugin, spec: { ...plugin.spec, settingName: undefined } } })

    await expect(
      main(['node', 'halo-cli', 'plugin', 'setting', 'plugin-example', '--json']),
    ).rejects.toThrow('未声明设置 Schema')
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })
})
