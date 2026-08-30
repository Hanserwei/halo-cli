import { cac, type CAC } from 'cac'

import { registerApiCommands } from './commands/api.js'
import { registerAuthCommands } from './commands/auth.js'
import { registerAttachmentCommands } from './commands/attachment.js'
import { registerCategoryCommands } from './commands/category.js'
import { registerCommentCommands } from './commands/comment.js'
import { registerExtensionCommands } from './commands/extension.js'
import { registerHaoCommands } from './commands/hao.js'
import { registerMenuCommands } from './commands/menu.js'
import { registerPageCommands } from './commands/page.js'
import { registerPluginCommands } from './commands/plugin.js'
import { registerPostCommands } from './commands/post.js'
import { registerSearchCommands } from './commands/search.js'
import { registerTagCommands } from './commands/tag.js'
import { registerThemeCommands } from './commands/theme.js'
import { CliError } from './errors.js'

export function createCli() {
  const cli = cac('halo-cli')
  cli.version('0.5.0')
  cli.help()
  cli.command('auth', '认证和连接配置')
  cli.command('post', '文章管理')
  cli.command('category', '分类管理')
  cli.command('tag', '标签管理')
  cli.command('page', '页面管理')
  cli.command('comment', '评论和回复管理')
  cli.command('attachment', '附件管理')
  cli.command('menu', '菜单和菜单项管理')
  cli.command('plugin', '插件生命周期和配置管理')
  cli.command('theme', '主题生命周期和配置管理')
  cli.command('extension', 'Halo 与插件 Extension 资源管理')
  cli.command('search', 'Halo 搜索索引查询')
  cli.command('api', '调用当前 Halo 站点的插件 API')
  cli.command('hao', 'Hao 1.7.3 适配检查与元数据目录')
  return cli
}

type CommandGroup =
  | 'api'
  | 'attachment'
  | 'auth'
  | 'category'
  | 'comment'
  | 'extension'
  | 'hao'
  | 'menu'
  | 'page'
  | 'plugin'
  | 'post'
  | 'search'
  | 'tag'
  | 'theme'

function createGroupCli(group: CommandGroup): CAC {
  const cli = cac(`halo-cli ${group}`)
  cli.version('0.5.0')
  cli.help()
  if (group === 'api') registerApiCommands(cli)
  if (group === 'auth') registerAuthCommands(cli)
  if (group === 'post') registerPostCommands(cli)
  if (group === 'category') registerCategoryCommands(cli)
  if (group === 'tag') registerTagCommands(cli)
  if (group === 'page') registerPageCommands(cli)
  if (group === 'comment') registerCommentCommands(cli)
  if (group === 'extension') registerExtensionCommands(cli)
  if (group === 'hao') registerHaoCommands(cli)
  if (group === 'attachment') registerAttachmentCommands(cli)
  if (group === 'menu') registerMenuCommands(cli)
  if (group === 'plugin') registerPluginCommands(cli)
  if (group === 'search') registerSearchCommands(cli)
  if (group === 'theme') registerThemeCommands(cli)
  return cli
}

function isCommandGroup(value: string | undefined): value is CommandGroup {
  return (
    value === 'api' ||
    value === 'attachment' ||
    value === 'auth' ||
    value === 'category' ||
    value === 'comment' ||
    value === 'extension' ||
    value === 'hao' ||
    value === 'menu' ||
    value === 'page' ||
    value === 'plugin' ||
    value === 'post' ||
    value === 'search' ||
    value === 'tag' ||
    value === 'theme'
  )
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
