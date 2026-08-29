import { cac, type CAC } from 'cac'

import { registerAuthCommands } from './commands/auth.js'
import { registerCategoryCommands } from './commands/category.js'
import { registerPostCommands } from './commands/post.js'
import { registerTagCommands } from './commands/tag.js'
import { CliError } from './errors.js'

export function createCli() {
  const cli = cac('halo-cli')
  cli.version('0.1.0')
  cli.help()
  cli.command('auth', '认证和连接配置')
  cli.command('post', '文章管理')
  cli.command('category', '分类管理')
  cli.command('tag', '标签管理')
  return cli
}

type CommandGroup = 'auth' | 'category' | 'post' | 'tag'

function createGroupCli(group: CommandGroup): CAC {
  const cli = cac(`halo-cli ${group}`)
  cli.version('0.1.0')
  cli.help()
  if (group === 'auth') registerAuthCommands(cli)
  if (group === 'post') registerPostCommands(cli)
  if (group === 'category') registerCategoryCommands(cli)
  if (group === 'tag') registerTagCommands(cli)
  return cli
}

function isCommandGroup(value: string | undefined): value is CommandGroup {
  return value === 'auth' || value === 'post' || value === 'category' || value === 'tag'
}

export async function main(argv = process.argv): Promise<void> {
  if (argv.length <= 2) {
    createCli().outputHelp()
    return
  }

  const group = argv[2]
  if (isCommandGroup(group)) {
    const groupCli = createGroupCli(group)
    if (argv.length === 3) {
      groupCli.outputHelp()
      return
    }
    groupCli.parse([argv[0] ?? 'node', `halo-cli ${group}`, ...argv.slice(3)], { run: false })
    if (!groupCli.matchedCommand && !groupCli.options.help && !groupCli.options.version) {
      throw new CliError(`未知命令：${group} ${argv[3] ?? ''}`.trim())
    }
    await groupCli.runMatchedCommand()
    return
  }

  if (!group?.startsWith('-')) {
    throw new CliError(`未知命令组：${group}`)
  }

  const cli = createCli()
  cli.parse(argv, { run: false })
  await cli.runMatchedCommand()
}
