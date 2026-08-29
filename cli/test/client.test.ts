import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { waitForDeletion } from '../src/client.js'

describe('asynchronous Halo deletion', () => {
  it('waits until the resource returns 404', async () => {
    const notFound = Object.assign(new Error('Not found'), {
      isAxiosError: true,
      response: { status: 404 },
    })
    const get = vi.fn().mockResolvedValueOnce({ status: 200 }).mockRejectedValueOnce(notFound)

    await waitForDeletion({ get } as unknown as AxiosInstance, '/resource/test', {
      intervalMs: 0,
      timeoutMs: 100,
    })

    expect(get).toHaveBeenCalledTimes(2)
  })

  it('reports a timeout when finalizers do not complete', async () => {
    const get = vi.fn().mockResolvedValue({ status: 200 })

    await expect(
      waitForDeletion({ get } as unknown as AxiosInstance, '/resource/test', {
        intervalMs: 1,
        timeoutMs: 2,
      }),
    ).rejects.toThrow('未在')
  })
})
