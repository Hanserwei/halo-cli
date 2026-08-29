import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import axios, { type AxiosInstance } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadAttachmentToFile } from '../src/commands/attachment.js'

const temporaryDirectories: string[] = []
const servers: Server[] = []

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind to TCP')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('attachment download', () => {
  it('streams redirects without forwarding Halo credentials to another origin', async () => {
    let externalAuthorization: string | undefined
    const externalUrl = await listen(
      createServer((request, response) => {
        externalAuthorization = request.headers.authorization
        response.end('external attachment')
      }),
    )
    let haloAuthorization: string | undefined
    const haloUrl = await listen(
      createServer((request, response) => {
        haloAuthorization = request.headers.authorization
        response.writeHead(302, { Location: `${externalUrl}/object.txt` })
        response.end()
      }),
    )
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-download-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'object.txt')
    const http = axios.create({
      baseURL: haloUrl,
      headers: { Authorization: 'Bearer pat_secret' },
      maxRedirects: 0,
      timeout: 30_000,
    })

    const result = await downloadAttachmentToFile(http, haloUrl, '/attachment', output, false)

    expect(await readFile(output, 'utf8')).toBe('external attachment')
    expect(result).toMatchObject({ size: 19, url: `${externalUrl}/object.txt` })
    expect(haloAuthorization).toBe('Bearer pat_secret')
    expect(externalAuthorization).toBeUndefined()
  })

  it('atomically refuses an existing file when force is false', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-download-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'existing.txt')
    await writeFile(output, 'keep me')
    const get = vi.fn()

    await expect(
      downloadAttachmentToFile(
        { get } as unknown as AxiosInstance,
        'https://halo.example',
        '/attachment',
        output,
        false,
      ),
    ).rejects.toThrow('--force')

    expect(get).not.toHaveBeenCalled()
    expect(await readFile(output, 'utf8')).toBe('keep me')
  })

  it('removes a newly-created partial file after a streaming failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-download-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'partial.txt')
    const broken = Readable.from(
      (async function* () {
        yield 'partial'
        throw new Error('stream failed')
      })(),
    )
    const get = vi.fn().mockResolvedValue({ data: broken, headers: {}, status: 200 })

    await expect(
      downloadAttachmentToFile(
        { get } as unknown as AxiosInstance,
        'https://halo.example',
        '/attachment',
        output,
        false,
      ),
    ).rejects.toThrow('stream failed')

    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an existing file when a forced download fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'halo-cli-download-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'existing.txt')
    await writeFile(output, 'original bytes')
    const broken = Readable.from(
      (async function* () {
        yield 'replacement prefix'
        throw new Error('stream failed')
      })(),
    )
    const get = vi.fn().mockResolvedValue({ data: broken, headers: {}, status: 200 })

    await expect(
      downloadAttachmentToFile(
        { get } as unknown as AxiosInstance,
        'https://halo.example',
        '/attachment',
        output,
        true,
      ),
    ).rejects.toThrow('stream failed')

    expect(await readFile(output, 'utf8')).toBe('original bytes')
  })
})
