import { printJson } from './output.js'
import { CliError } from './errors.js'
import { redactSecrets, writeJsonExport } from './secrets.js'
import { textValue } from './options.js'

export interface StructuredOutputOptions {
  force?: boolean
  includeSecrets?: boolean
  json?: boolean
  output?: unknown
  redact?: boolean
}

export async function printOrExportJson(
  value: unknown,
  options: StructuredOutputOptions,
  label: string,
): Promise<void> {
  const output = textValue(options.output, '--output')?.trim()
  if (options.includeSecrets && !output) {
    throw new CliError(`导出${label}中的敏感字段必须同时指定 --output，避免直接打印到终端。`)
  }
  if (options.force && !output) {
    throw new CliError('--force 必须与 --output 一起使用。')
  }

  const redacted = options.redact !== false && !options.includeSecrets
  const exported = redacted ? redactSecrets(value) : value
  if (!output) {
    printJson(exported)
    return
  }

  await writeJsonExport(output, exported, options.force)
  if (options.json) {
    printJson({ exported: true, output, redacted })
  } else {
    process.stdout.write(`已导出${label}到 ${output}${redacted ? '（敏感字段已脱敏）' : ''}。\n`)
  }
}
