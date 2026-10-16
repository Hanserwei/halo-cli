import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accessKeyApi } from '../access-keys'
import type { AccessKey, AccessKeySecret, CreateAccessKeyRequest, Scope } from '../types'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@halo-dev/api-client', () => ({ axiosInstance: http }))

const base = '/apis/console.api.halo-cli.halo.run/v1alpha1'
const name = '部署/key +?#%中文'
const encodedName = '%E9%83%A8%E7%BD%B2%2Fkey%20%2B%3F%23%25%E4%B8%AD%E6%96%87'
const key: AccessKey = {
  name,
  displayName: 'Deploy',
  keyPrefix: 'cli_test',
  ownerName: 'admin',
  scopes: ['posts:read'],
  enabled: true,
  allowedIpRanges: ['192.0.2.0/24'],
  expiresAt: null,
}
const issued: AccessKeySecret = { key, token: 'one-time-token' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('accessKeyApi', () => {
  it('GET /keys returns metadata without adding credentials', async () => {
    const keys: AccessKey[] = [key]
    http.get.mockResolvedValue({ data: keys })

    const result = await accessKeyApi.listKeys()

    expect(http.get).toHaveBeenCalledExactlyOnceWith(`${base}/keys`)
    expect(result).toBe(keys)
    expect(result[0]).not.toHaveProperty('token')
  })

  it('GET /scopes returns the scope catalog', async () => {
    const scopes: Scope[] = [
      { name: 'posts:read', displayName: 'Read posts', description: 'List and read posts' },
    ]
    http.get.mockResolvedValue({ data: scopes })

    await expect(accessKeyApi.listScopes()).resolves.toBe(scopes)

    expect(http.get).toHaveBeenCalledExactlyOnceWith(`${base}/scopes`)
  })

  it('POST /keys transmits the complete create body and returns the one-time secret', async () => {
    const request: CreateAccessKeyRequest = {
      displayName: 'Deploy',
      scopes: ['posts:read'],
      allowedIpRanges: ['192.0.2.0/24'],
      expiresAt: null,
    }
    http.post.mockResolvedValue({ data: issued })

    await expect(accessKeyApi.createKey(request)).resolves.toBe(issued)

    expect(http.post).toHaveBeenCalledExactlyOnceWith(`${base}/keys`, request)
    expect(http.post.mock.calls[0]?.[1]).toBe(request)
  })

  it.each([true, false])(
    'PUT /keys/:name encodes the name and preserves enabled=%s and expiresAt:null',
    async (enabled) => {
      const request = {
        displayName: 'Updated deploy key',
        scopes: ['posts:read', 'posts:write'],
        allowedIpRanges: [],
        enabled,
        expiresAt: null,
      }
      const updated: AccessKey = { ...key, ...request }
      http.put.mockResolvedValue({ data: updated })

      await expect(accessKeyApi.updateKey(name, request)).resolves.toBe(updated)

      expect(http.put).toHaveBeenCalledExactlyOnceWith(`${base}/keys/${encodedName}`, request)
      expect(http.put.mock.calls[0]?.[1]).toBe(request)
      expect(http.put.mock.calls[0]?.[1]).toHaveProperty('enabled', enabled)
      expect(http.put.mock.calls[0]?.[1]).toHaveProperty('expiresAt', null)
    },
  )

  it('POST /keys/:name/rotate encodes the name, sends no body and returns the new secret', async () => {
    http.post.mockResolvedValue({ data: issued })

    await expect(accessKeyApi.rotateKey(name)).resolves.toBe(issued)

    expect(http.post).toHaveBeenCalledExactlyOnceWith(`${base}/keys/${encodedName}/rotate`)
  })

  it('DELETE /keys/:name encodes the name and accepts a 204 without response data', async () => {
    http.delete.mockResolvedValue({ status: 204 })

    await expect(accessKeyApi.deleteKey(name)).resolves.toBeUndefined()

    expect(http.delete).toHaveBeenCalledExactlyOnceWith(`${base}/keys/${encodedName}`)
  })
})
