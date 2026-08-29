import { toCliError } from './errors.js'
import { main } from './index.js'

main().catch((error: unknown) => {
  const cliError = toCliError(error)
  process.stderr.write(`错误：${cliError.message}\n`)
  process.exitCode = 1
})
