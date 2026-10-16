import { axiosInstance } from '@halo-dev/api-client'
import type { AccessKey, AccessKeyApi, AccessKeySecret, Scope } from './types'

export const cliApiBase = '/apis/console.api.halo-cli.halo.run/v1alpha1'
export const cliDownloadPath = `${cliApiBase}/downloads/cli`

export const accessKeyApi: AccessKeyApi = {
  async listKeys() {
    const { data } = await axiosInstance.get<AccessKey[]>(`${cliApiBase}/keys`)
    return data
  },
  async listScopes() {
    const { data } = await axiosInstance.get<Scope[]>(`${cliApiBase}/scopes`)
    return data
  },
  async createKey(request) {
    const { data } = await axiosInstance.post<AccessKeySecret>(`${cliApiBase}/keys`, request)
    return data
  },
  async updateKey(name, request) {
    const { data } = await axiosInstance.put<AccessKey>(
      `${cliApiBase}/keys/${encodeURIComponent(name)}`,
      request,
    )
    return data
  },
  async rotateKey(name) {
    const { data } = await axiosInstance.post<AccessKeySecret>(
      `${cliApiBase}/keys/${encodeURIComponent(name)}/rotate`,
    )
    return data
  },
  async deleteKey(name) {
    await axiosInstance.delete(`${cliApiBase}/keys/${encodeURIComponent(name)}`)
  },
}
