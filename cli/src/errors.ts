import axios from 'axios'

export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

interface HaloProblem {
  detail?: string
  message?: string
  title?: string
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error
  }

  if (axios.isAxiosError<HaloProblem>(error)) {
    const status = error.response?.status
    const problem = error.response?.data
    const detail = problem?.detail ?? problem?.message ?? problem?.title ?? error.message

    if (status === 401) {
      return new CliError('认证失败，请检查个人令牌是否有效。')
    }
    if (status === 403) {
      return new CliError('当前个人令牌没有执行此操作的权限。')
    }
    if (status === 404) {
      return new CliError(`资源不存在：${detail}`)
    }
    return new CliError(`${status ? `Halo API ${status}` : 'Halo API 请求失败'}：${detail}`)
  }

  return new CliError(error instanceof Error ? error.message : String(error))
}
