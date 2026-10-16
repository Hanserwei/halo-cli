import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import axios, { type AxiosInstance } from 'axios'
import { cac } from 'cac'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ClientModule from '../src/client.js'
const mocks = vi.hoisted(() => ({ createHaloClient: vi.fn() }))
vi.mock('../src/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  createHaloClient: mocks.createHaloClient,
}))

import { preflightAttachmentUpload, registerAttachmentCommands, uploadLocalAttachment } from '../src/commands/attachment.js'

const directories: string[] = []
const servers: Server[] = []
const policy = {
  apiVersion: 'storage.halo.run/v1alpha1',
  kind: 'Policy',
  metadata: { name: 'my-s3-policy', version: 3 },
  spec: { displayName: 'S3', templateName: 's3os', configMapName: 'private-config' },
}
const template = {
  apiVersion: 'storage.halo.run/v1alpha1', kind: 'PolicyTemplate', metadata: { name: 's3os' },
  spec: { displayName: 'S3', settingName: 's3os-policy-template-setting' },
}
const attachment = {
  apiVersion: 'storage.halo.run/v1alpha1', kind: 'Attachment', metadata: { name: 'uploaded-object' },
  spec: { policyName: 'my-s3-policy', groupName: 'images' },
  status: { permalink: 'https://cdn.example/image.txt' },
}

afterEach(async () => {
  vi.restoreAllMocks()
  mocks.createHaloClient.mockReset()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function uploadFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'halo-cli-upload-'))
  directories.push(directory)
  const file = join(directory, 'image.txt')
  await writeFile(file, 'actual file bytes')
  return file
}

async function runAttachment(...args: string[]): Promise<void> {
  const cli = cac('attachment')
  registerAttachmentCommands(cli)
  cli.parse(['node', 'attachment', ...args], { run: false })
  await cli.runMatchedCommand()
}

describe('Halo attachment upload and S3 policy selection', () => {
  it('sends multipart file, policyName and groupName through the Halo endpoint without reading credentials', async () => {
    const requests: Array<{ method?: string; url?: string; contentType?: string; authorization?: string; body: Buffer }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({ method: request.method, url: request.url, contentType: request.headers['content-type'], authorization: request.headers.authorization, body: Buffer.concat(chunks) })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(attachment))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TCP address')
    const http = axios.create({ baseURL: `http://127.0.0.1:${address.port}`, headers: { Authorization: 'Bearer hcli_upload_test' }, maxRedirects: 0 })

    const result = await uploadLocalAttachment(http, { file: await uploadFile(), policyName: 'my-s3-policy', groupName: 'images' })

    expect(result).toEqual(attachment)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/apis/api.console.halo.run/v1alpha1/attachments/upload', authorization: 'Bearer hcli_upload_test' })
    expect(requests[0]!.contentType).toMatch(/^multipart\/form-data; boundary=/u)
    const payload = requests[0]!.body.toString('utf8')
    expect(payload).toContain('name="file"; filename="image.txt"')
    expect(payload).toContain('actual file bytes')
    expect(payload).toMatch(/name="policyName"\r\n\r\nmy-s3-policy\r\n/u)
    expect(payload).toMatch(/name="groupName"\r\n\r\nimages\r\n/u)
    expect(payload).not.toContain('accessKey')
    expect(payload).not.toContain('accessSecret')
    expect(payload).not.toContain('configMapName')
  })

  it('omits an empty group and sends the policy instance name rather than the template name', async () => {
    const post = vi.fn().mockResolvedValue({ data: attachment })
    const get = vi.fn()
    await uploadLocalAttachment({ get, post } as unknown as AxiosInstance, { file: await uploadFile(), policyName: 'my-s3-policy', groupName: '  ' })
    expect(get).not.toHaveBeenCalled()
    const form = post.mock.calls[0]![1] as FormData
    expect(form.get('policyName')).toBe('my-s3-policy')
    expect(form.has('groupName')).toBe(false)
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('optionally preflights only Policy, PolicyTemplate and Group, without reading Setting or ConfigMap', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: template }).mockResolvedValueOnce({ data: { metadata: { name: 'images' } } })
    const post = vi.fn().mockResolvedValue({ data: attachment })
    await uploadLocalAttachment({ get, post } as unknown as AxiosInstance, { file: await uploadFile(), policyName: 'my-s3-policy', groupName: 'images', preflight: true })
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/apis/storage.halo.run/v1alpha1/policies/my-s3-policy',
      '/apis/storage.halo.run/v1alpha1/policytemplates/s3os',
      '/apis/storage.halo.run/v1alpha1/groups/images',
    ])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('dry-run checks the file and strategy and never posts or reads configuration', async () => {
    const file = await uploadFile()
    const get = vi.fn().mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: template })
    const post = vi.fn()
    const result = await uploadLocalAttachment({ get, post } as unknown as AxiosInstance, { file, policyName: 'my-s3-policy', dryRun: true })
    expect(result).toEqual({ dryRun: true, file, filename: 'image.txt', size: 17, policyName: 'my-s3-policy', groupName: undefined })
    expect(get).toHaveBeenCalledTimes(2)
    expect(post).not.toHaveBeenCalled()
  })

  it('registers --dry-run on the upload command and prints the planned policy', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: template })
    const post = vi.fn()
    mocks.createHaloClient.mockResolvedValue({ http: { get, post } })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runAttachment('upload', '--file', await uploadFile(), '--policy', 'my-s3-policy', '--dry-run', '--json')
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"dryRun": true'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"policyName": "my-s3-policy"'))
    expect(post).not.toHaveBeenCalled()
  })

  it('rejects a nonexistent file before making remote requests', async () => {
    const get = vi.fn()
    const post = vi.fn()
    const file = await uploadFile()
    await expect(uploadLocalAttachment({ get, post } as unknown as AxiosInstance, { file: `${file}.missing`, policyName: 'my-s3-policy', preflight: true })).rejects.toThrow('无法读取')
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('rejects a directory instead of sending it as a file', async () => {
    const file = await uploadFile()
    const http = { get: vi.fn(), post: vi.fn() }
    await expect(uploadLocalAttachment(http as unknown as AxiosInstance, { file: join(file, '..'), policyName: 'my-s3-policy' })).rejects.toThrow('普通文件')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('fails preflight if the S3 template is missing and never attempts upload', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: policy }).mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { detail: 'secret-value' } } })
    const post = vi.fn()
    await expect(uploadLocalAttachment({ get, post } as unknown as AxiosInstance, { file: await uploadFile(), policyName: 'my-s3-policy', preflight: true })).rejects.toThrow('S3 对象存储插件')
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses a deleting policy or group', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: { ...policy, metadata: { ...policy.metadata, deletionTimestamp: 'now' } } })
    await expect(preflightAttachmentUpload({ get } as unknown as AxiosInstance, 'my-s3-policy')).rejects.toThrow('正在删除')
    get.mockReset().mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: template }).mockResolvedValueOnce({ data: { metadata: { name: 'images', deletionTimestamp: 'now' } } })
    await expect(preflightAttachmentUpload({ get } as unknown as AxiosInstance, 'my-s3-policy', 'images')).rejects.toThrow('分组正在删除')
  })

  it.each([400, 404, 409])('sanitizes upload HTTP %s without leaking a response body containing S3 credentials', async (status) => {
    const post = vi.fn().mockRejectedValue({ isAxiosError: true, response: { status, data: { detail: 'accessSecret=do-not-print' } } })
    const error = await uploadLocalAttachment({ post } as unknown as AxiosInstance, { file: await uploadFile(), policyName: 'my-s3-policy' }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(`HTTP ${status}`)
    expect((error as Error).message).not.toContain('do-not-print')
  })

  it('upload-url keeps the same policyName JSON field and does not fetch credentials', async () => {
    const get = vi.fn()
    const post = vi.fn().mockResolvedValue({ data: attachment })
    mocks.createHaloClient.mockResolvedValue({ http: { get, post } })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runAttachment('upload-url', 'https://source.example/image.png', '--policy', 'my-s3-policy', '--group', 'images', '--filename', 'renamed.png', '--json')
    expect(post).toHaveBeenCalledWith('/apis/api.console.halo.run/v1alpha1/attachments/-/upload-from-url', {
      filename: 'renamed.png', groupName: 'images', policyName: 'my-s3-policy', url: 'https://source.example/image.png',
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('upload-url dry-run preflights the policy and never posts', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: template })
    const post = vi.fn()
    mocks.createHaloClient.mockResolvedValue({ http: { get, post } })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runAttachment('upload-url', 'https://source.example/image.png', '--policy', 'my-s3-policy', '--dry-run')
    expect(post).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(2)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"dryRun": true'))
  })

  it.each(['file:///etc/passwd', 'ftp://example.test/file', 'not a url', 'https://user:password@example.test/file'])('rejects invalid or credential-bearing source URL %s before connecting', async (url) => {
    await expect(runAttachment('upload-url', url, '--policy', 'my-s3-policy')).rejects.toThrow('URL')
    expect(mocks.createHaloClient).not.toHaveBeenCalled()
  })
})
