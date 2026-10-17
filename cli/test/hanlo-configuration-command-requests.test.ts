import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '../src/client.js'
import type { Setting } from '../src/types.js'

const mocks = vi.hoisted(() => ({ createHaloClient: vi.fn(), get: vi.fn(), put: vi.fn() }))
vi.mock('../src/client.js', async (original) => ({ ...(await original<typeof ClientModule>()), createHaloClient: mocks.createHaloClient }))
import { main } from '../src/index.js'

// The list and its anonymous child follow Hanlo settings.yaml, author_info_left_tags.
const schema: Setting = {
  apiVersion: 'v1alpha1', kind: 'Setting', metadata: { name: 'theme-hanlo-setting' },
  spec: { forms: [{ group: 'about', formSchema: [
    { $formkit: 'list', name: 'author_info_left_tags', label: '头像左侧标签', itemType: 'string', children: [
      { $formkit: 'text', index: '$index', validation: 'required', label: '个人标签' },
    ] },
  ] }] },
}
const current = { about: { author_info_left_tags: ['旧标签'], content: 'Keep' }, nav: { enabled: true } }
const configPath = '/apis/api.console.halo.run/v1alpha1/themes/theme-hanlo/json-config'

function mockConfiguration() {
  mocks.get.mockResolvedValueOnce({ data: { spec: { settingName: 'theme-hanlo-setting', configMapName: 'theme-hanlo-configMap' } } })
    .mockResolvedValueOnce({ data: schema }).mockResolvedValueOnce({ data: current })
  mocks.put.mockResolvedValue({ status: 204 })
}

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-hanlo-config-'))
  mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get, put: mocks.put }, name: 'test', url: 'https://halo.example' })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  Object.values(mocks).forEach((mock) => mock.mockReset())
  await rm(directory, { recursive: true, force: true })
})

describe('Hanlo anonymous list input requests', () => {
  it.each([
    { index: '0', expected: ['新标签'] },
    { index: '-', expected: ['旧标签', '新标签'] },
  ])('sets the current list element at index $index', async ({ index, expected }) => {
    mockConfiguration()
    await main(['node', 'halo-cli', 'hanlo', 'config-set', `/about/author_info_left_tags/${index}`, '"新标签"', '--json'])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configPath, {
      ...current, about: { ...current.about, author_info_left_tags: expected },
    })
  })

  it('imports ordered string elements and preserves sibling configuration', async () => {
    mockConfiguration()
    const file = join(directory, 'about.json')
    const tags = ['徒步爱好者', '持续学习中']
    await writeFile(file, JSON.stringify({ about: { author_info_left_tags: tags } }))
    await main(['node', 'halo-cli', 'hanlo', 'config-import', '--file', file, '--json'])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(configPath, {
      ...current, about: { ...current.about, author_info_left_tags: tags },
    })
  })

  describe.each([false, true])('invalid imports (dry-run: %s)', (dryRun) => {
    it.each([
      { entry: 123, error: '类型' },
      { entry: false, error: '类型' },
      { entry: {}, error: '类型' },
      { entry: null, error: '类型' },
      { entry: '', error: '必填配置字段缺失' },
    ])('rejects invalid element $entry before writing', async ({ entry, error }) => {
      mockConfiguration()
      const file = join(directory, 'invalid-about.json')
      await writeFile(file, JSON.stringify({ about: { author_info_left_tags: ['有效标签', entry] } }))
      await expect(main(['node', 'halo-cli', 'hanlo', 'config-import', '--file', file, ...(dryRun ? ['--dry-run'] : []), '--json']))
        .rejects.toThrow(error)
      expect(mocks.put).not.toHaveBeenCalled()
    })
  })
})
