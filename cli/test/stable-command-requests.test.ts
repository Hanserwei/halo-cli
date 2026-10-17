import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '../src/client.js'

const mocks = vi.hoisted(() => ({ createHaloClient: vi.fn(), get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn(), waitForDeletion: vi.fn() }))
vi.mock('../src/client.js', async (original) => ({ ...(await original<typeof ClientModule>()), createHaloClient: mocks.createHaloClient, waitForDeletion: mocks.waitForDeletion }))
import { main } from '../src/index.js'

let directory: string
const schema = { apiVersion: 'v1alpha1', kind: 'Setting', metadata: { name: 'system' }, spec: { forms: [
  { group: 'basic', formSchema: [{ $formkit: 'text', name: 'title', validation: 'required' }] },
  { group: 'seo', formSchema: [{ $formkit: 'switch', name: 'noIndex', value: false }] },
] } }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'halo-stable-'))
  mocks.createHaloClient.mockResolvedValue({ http: { get: mocks.get, put: mocks.put, post: mocks.post, delete: mocks.delete, defaults: { headers: { Authorization: 'Bearer pat_test' } } }, name: 'test', url: 'https://halo.example' })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  Object.values(mocks).forEach((mock) => mock.mockReset())
  await rm(directory, { recursive: true, force: true })
})

describe('Halo 2.27 stable commands', () => {
  it('writes only the selected native system group and preserves sibling fields', async () => {
    mocks.get.mockResolvedValueOnce({ data: schema }).mockResolvedValueOnce({ data: { noIndex: true, description: 'keep' } })
    mocks.put.mockResolvedValue({ status: 204 })
    await main(['node', 'halo-cli', 'settings', 'set', 'seo', '/noIndex', 'false', '--json'])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/apis/console.api.halo.run/v1alpha1/systemconfigs/seo', { noIndex: false, description: 'keep' })
    expect(mocks.get).not.toHaveBeenCalledWith('/apis/console.api.halo.run/v1alpha1/systemconfigs/basic')
  })

  it('previews a reset without a write and preserves a required site title without a default', async () => {
    mocks.get.mockResolvedValueOnce({ data: schema }).mockResolvedValueOnce({ data: { title: 'Personal site' } })
    await main(['node', 'halo-cli', 'settings', 'reset', 'basic', '--dry-run', '--json'])
    expect(mocks.put).not.toHaveBeenCalled()
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Personal site'))
  })

  it('configures Hanlo through its live schema and keeps other groups intact', async () => {
    const themeSchema = { ...schema, spec: { forms: [{ group: 'equipment', formSchema: [{ $formkit: 'text', name: 'bigTitle' }] }] } }
    mocks.get.mockResolvedValueOnce({ data: { spec: { settingName: 'theme-hanlo-setting', configMapName: 'theme-hanlo-configMap' } } })
      .mockResolvedValueOnce({ data: themeSchema }).mockResolvedValueOnce({ data: { equipment: { bigTitle: 'Old', smallTitle: 'Keep' }, nav: { enabled: true } } })
    mocks.put.mockResolvedValue({ status: 204 })
    await main(['node', 'halo-cli', 'hanlo', 'config-set', '/equipment/bigTitle', 'My equipment', '--json'])
    expect(mocks.put).toHaveBeenCalledWith('/apis/api.console.halo.run/v1alpha1/themes/theme-hanlo/json-config', { equipment: { bigTitle: 'My equipment', smallTitle: 'Keep' }, nav: { enabled: true } })
  })

  it('writes S3 configuration using the versioned policy API and never prints its secret', async () => {
    const policy = { metadata: { name: 's3-personal', version: 7 }, spec: { templateName: 's3os', displayName: 'S3', configMapName: 's3-config' } }
    const storageSchema = { ...schema, spec: { forms: [{ group: 'default', formSchema: [{ $formkit: 'text', name: 'bucket', validation: 'required' }, { $formkit: 'password', name: 'accessSecret' }] }] } }
    mocks.get.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { spec: { settingName: 's3os-policy-template-setting' } } })
      .mockResolvedValueOnce({ data: storageSchema }).mockResolvedValueOnce({ data: { policyVersion: 7, configMapName: 's3-config', configMapVersion: 12, config: { bucket: 'my-bucket', accessSecret: 'very-private-s3-value' } } })
    mocks.put.mockResolvedValue({ status: 204 })
    await main(['node', 'halo-cli', 'storage', 'config-set', 's3-personal', '/default/bucket', 'new-bucket', '--json'])
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual([
      '/apis/storage.halo.run/v1alpha1/policies/s3-personal',
      '/apis/storage.halo.run/v1alpha1/policytemplates/s3os',
      '/api/v1alpha1/settings/s3os-policy-template-setting',
      '/apis/console.api.halo-cli.halo.run/v1alpha1/policies/s3-personal/configs/default',
    ])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/apis/console.api.halo-cli.halo.run/v1alpha1/policies/s3-personal/configs/default', { policyVersion: 7, configMapName: 's3-config', configMapVersion: 12, config: { bucket: 'new-bucket', accessSecret: 'very-private-s3-value' } })
    expect(process.stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('very-private-s3-value'))
  })

  it('initializes an unbound policy after reading the safe API with an explicit null association', async () => {
    const policy = { metadata: { name: 'new-policy', version: 3 }, spec: { templateName: 's3os' } }
    const storageSchema = { ...schema, spec: { forms: [{ group: 'default', formSchema: [{ $formkit: 'text', name: 'bucket', validation: 'required' }] }] } }
    mocks.get.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { spec: { settingName: 's3os-setting' } } }).mockResolvedValueOnce({ data: storageSchema })
      .mockResolvedValueOnce({ data: { policyVersion: 3, configMapName: null, configMapVersion: null, config: {} } })
    mocks.put.mockResolvedValue({ status: 204 })
    const file = join(directory, 'new-policy.json')
    await writeFile(file, JSON.stringify({ bucket: 'new-bucket' }))
    await main(['node', 'halo-cli', 'storage', 'config-import', 'new-policy', '--file', file, '--json'])
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual([
      '/apis/storage.halo.run/v1alpha1/policies/new-policy',
      '/apis/storage.halo.run/v1alpha1/policytemplates/s3os',
      '/api/v1alpha1/settings/s3os-setting',
      '/apis/console.api.halo-cli.halo.run/v1alpha1/policies/new-policy/configs/default',
    ])
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/apis/console.api.halo-cli.halo.run/v1alpha1/policies/new-policy/configs/default', { policyVersion: 3, configMapName: null, configMapVersion: null, config: { bucket: 'new-bucket' } })
  })

  it('creates equipment using the independent GVK and preserves repeated ordered attributes', async () => {
    const file = join(directory, 'equipment.json')
    const spec = { displayName: 'Workstation', groupName: 'work', attributes: [{ label: 'Disk', value: 'First' }, { label: 'Disk', value: 'Second' }] }
    await writeFile(file, JSON.stringify(spec))
    mocks.post.mockResolvedValue({ data: { spec } })
    await main(['node', 'halo-cli', 'equipment', 'create', '--file', file, '--json'])
    expect(mocks.post).toHaveBeenCalledWith('/apis/equipment.hanserwei.github.io/v1alpha1/equipments', expect.objectContaining({ apiVersion: 'equipment.hanserwei.github.io/v1alpha1', spec }))
  })

  it('creates a Moment through the moderation-aware Console endpoint', async () => {
    mocks.post.mockResolvedValue({ data: { spec: { approved: true } } })
    await main(['node', 'halo-cli', 'moment', 'create', '--content', '# Hello', '--visible', 'PRIVATE', '--json'])
    expect(mocks.post).toHaveBeenCalledWith('/apis/console.api.moment.halo.run/v1alpha1/moments', expect.objectContaining({ spec: { visible: 'PRIVATE', content: { raw: '# Hello', html: '<h1>Hello</h1>\n' } } }))
  })

  it('uploads a photo through the plugin business API without pretending a per-request S3 policy exists', async () => {
    const file = join(directory, 'image.png')
    await writeFile(file, 'image')
    mocks.post.mockResolvedValue({ data: { metadata: { name: 'photo' } } })
    await main(['node', 'halo-cli', 'photo', 'upload', '--file', file, '--group', 'album', '--json'])
    expect(mocks.post).toHaveBeenCalledWith('/apis/console.api.photo.halo.run/v1alpha1/photos/upload', expect.any(FormData))
    const form = mocks.post.mock.calls[0]?.[1] as FormData
    expect(form.get('group')).toBe('album')
    expect((form.get('file') as Blob).type).toBe('image/png')
    expect(form.get('policyName')).toBeNull()
  })

  it('deletes only a photo group by default and requires explicit opt-in to remove its photos', async () => {
    await main(['node', 'halo-cli', 'photo', 'group-delete', 'album', '--yes', '--json'])
    expect(mocks.delete).toHaveBeenCalledWith('/apis/console.api.photo.halo.run/v1alpha1/photogroups/album', { params: { deletePhotos: false, withAttachment: false } })
  })

  it('requires confirmation for application approval and preserves provider request bodies', async () => {
    await expect(main(['node', 'halo-cli', 'link', 'application-approve', 'request-one'])).rejects.toThrow('--yes')
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.post.mockResolvedValue({ data: { kind: 'Link' } })
    await main(['node', 'halo-cli', 'link', 'application-approve', 'request-one', '--yes', '--json'])
    expect(mocks.post).toHaveBeenCalledWith('/apis/console.api.link.halo.run/v1alpha1/linkapplications/request-one/approve', {})
  })
})

it('deletes an equipment group through the plugin cascade endpoint', async () => {
  await main(['node', 'halo-cli', 'equipment', 'group-delete', 'work', '--yes', '--json'])
  expect(mocks.delete).toHaveBeenCalledWith('/apis/console.api.equipment.hanserwei.github.io/v1alpha1/equipmentgroups/work')
  expect(mocks.waitForDeletion).toHaveBeenCalledWith(expect.anything(), '/apis/equipment.hanserwei.github.io/v1alpha1/equipmentgroups/work')
})
