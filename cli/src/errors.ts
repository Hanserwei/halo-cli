import axios from 'axios'

export class CliError extends Error {
  constructor(message: string) {
    super(message.replace(/(?:hcli_|pat_)[^\s"'<>\\]+/gu, '[REDACTED]'))
    this.name = 'CliError'
  }
}


export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status

    if (status === 401) {
      return new CliError('认证失败，请检查凭据是否有效。')
    }
    if (status === 403) {
      return new CliError('当前凭据没有执行此操作的权限。')
    }
    if (status === 404) {
      return new CliError('资源不存在。')
    }
    if (status === 400 || status === 409 || status === 422) {
      const data: unknown = error.response?.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const fields = data as Record<string, unknown>
        const value = [fields.detail, fields.message, fields.title].find(
          (item): item is string => typeof item === 'string' && Boolean(item.trim()),
        )
        if (value) {
          const authorization = error.config?.headers?.Authorization ?? error.config?.headers?.authorization
          const credential = typeof authorization === 'string'
            ? authorization.replace(/^Bearer\s+/iu, '')
            : undefined
          const detail = (credential ? value.replaceAll(credential, '[REDACTED]') : value)
            .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
            .slice(0, 2000)
          return new CliError(`Halo API 请求失败（HTTP ${status}）：${detail}`)
        }
      }
    }
    return new CliError(status ? `Halo API 请求失败（HTTP ${status}）。` : 'Halo API 请求失败，请检查网络连接。')
  }

  return new CliError('命令执行失败，请检查输入和本地配置。')
}
