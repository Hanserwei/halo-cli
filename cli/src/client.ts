import axios, { type AxiosInstance } from 'axios'

import { CliError } from './errors.js'
import type { ConnectionOptions } from './types.js'
import { resolveProfile } from './config.js'

export interface HaloConnection {
  http: AxiosInstance
  name: string
  url: string
}

export async function createHaloClient(options: ConnectionOptions): Promise<HaloConnection> {
  const { name, profile } = await resolveProfile(options)
  const http = axios.create({
    baseURL: profile.url,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${profile.token}`,
      'User-Agent': 'halo-cli/0.1.0',
    },
    paramsSerializer: { indexes: null },
    timeout: 30_000,
  })
  return { http, name, url: profile.url }
}

export function resourcePath(resource: 'categories' | 'posts' | 'tags', name?: string): string {
  const base = `/apis/content.halo.run/v1alpha1/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function consolePostPath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/posts'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export async function waitForDeletion(
  http: AxiosInstance,
  path: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 100
  const timeoutMs = options.timeoutMs ?? 15_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      await http.get(path)
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return
      }
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new CliError(`删除请求已提交，但资源未在 ${timeoutMs / 1000} 秒内完成清理。`)
}
