import { describe, expect, it } from 'vitest'

import { toCliError } from '../src/errors.js'

describe('structured API validation errors', () => {
  it.each([400, 409, 422])('keeps useful validation details for HTTP %s', (status) => {
    const error = Object.assign(new Error('transport detail'), {
      isAxiosError: true,
      response: { status, data: { detail: 'Template htmlBody is invalid at line 4, column 8.' } },
    })
    expect(toCliError(error).message).toContain(`HTTP ${status}`)
    expect(toCliError(error).message).toContain('line 4, column 8')
  })

  it('redacts the actual authorization value and strips terminal control characters', () => {
    const error = Object.assign(new Error('transport detail'), {
      isAxiosError: true,
      config: { headers: { Authorization: 'Bearer legacy-secret-value' } },
      response: { status: 400, data: { detail: 'Invalid template: legacy-secret-value hcli_secret pat_secret\u001b[31m' } },
    })
    const message = toCliError(error).message
    expect(message).toContain('Invalid template')
    expect(message).not.toMatch(/legacy-secret-value|hcli_secret|pat_secret|\u001b/u)
  })

  it('does not publish unexpected server failures or raw transport errors', () => {
    const error = Object.assign(new Error('private transport data'), {
      isAxiosError: true,
      response: { status: 500, data: { detail: 'private server data' } },
    })
    expect(toCliError(error).message).not.toContain('private')
  })
})
