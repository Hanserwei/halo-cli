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
      'User-Agent': 'halo-cli/0.5.0',
    },
    paramsSerializer: { indexes: null },
    maxRedirects: 0,
    timeout: 30_000,
  })
  return { http, name, url: profile.url }
}

export function resourcePath(
  resource: 'categories' | 'comments' | 'posts' | 'replies' | 'singlepages' | 'tags',
  name?: string,
): string {
  const base = `/apis/content.halo.run/v1alpha1/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function storagePath(
  resource: 'attachments' | 'groups' | 'policies',
  name?: string,
): string {
  const base = `/apis/storage.halo.run/v1alpha1/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function menuPath(resource: 'menuitems' | 'menus', name?: string): string {
  const base = `/api/v1alpha1/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function consoleMenuPath(name?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/menus'
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function consoleMenuItemPath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/menuitems'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function systemConfigPath(group: string): string {
  return `/apis/console.api.halo.run/v1alpha1/systemconfigs/${encodeURIComponent(group)}`
}

export function extensionPath(
  group: 'plugin.halo.run' | 'theme.halo.run',
  resource: 'plugins' | 'themes',
  name?: string,
): string {
  const base = `/apis/${group}/v1alpha1/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function customExtensionPath(
  group: string,
  version: string,
  resource: string,
  name?: string,
): string {
  const segment = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
  if (![group, version, resource].every((value) => segment.test(value))) {
    throw new CliError('Extension 引用无效，应为 group/version/resource。')
  }
  const base = `/apis/${group}/${version}/${resource}`
  return name ? `${base}/${encodeURIComponent(name)}` : base
}

export function consolePluginPath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/plugins'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function consoleThemePath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/themes'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function consoleActivatedThemePath(): string {
  return '/apis/api.console.halo.run/v1alpha1/themes/-/activation'
}

export function consolePostPath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/posts'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function consoleSinglePagePath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/singlepages'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function consoleCommentPath(name?: string, action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/comments'
  const resource = name ? `${base}/${encodeURIComponent(name)}` : base
  return action ? `${resource}/${action}` : resource
}

export function consoleReplyPath(): string {
  return '/apis/api.console.halo.run/v1alpha1/replies'
}

export function consoleAttachmentPath(action?: string): string {
  const base = '/apis/api.console.halo.run/v1alpha1/attachments'
  return action ? `${base}/${action}` : base
}

export function hasSameOrigin(baseUrl: string, targetUrl: string): boolean {
  return new URL(targetUrl, baseUrl).origin === new URL(baseUrl).origin
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
