import type { CAC } from 'cac'

import {
  consoleMenuItemPath,
  consoleMenuPath,
  createHaloClient,
  menuPath,
  systemConfigPath,
  waitForDeletion,
} from '../client.js'
import { CliError } from '../errors.js'
import { positiveInteger, required, requireConfirmation, textValue } from '../options.js'
import {
  printJson,
  printMenu,
  printMenuItem,
  printMenuItemTree,
  printMenuList,
} from '../output.js'
import { filterAndPaginate } from '../pagination.js'
import type {
  ConnectionOptions,
  Menu,
  MenuItem,
  MenuItemPositionRequest,
  MenuItemTarget,
  MenuItemTreeNode,
  MenuSystemConfig,
  OutputOptions,
  Page,
} from '../types.js'

type MenuRefKind = 'Category' | 'Post' | 'SinglePage' | 'Tag'

interface MenuOptions extends ConnectionOptions, OutputOptions {
  before?: unknown
  displayName?: unknown
  href?: unknown
  keyword?: unknown
  menu?: unknown
  page?: string
  parent?: unknown
  refKind?: unknown
  refName?: unknown
  size?: string
  target?: unknown
  yes?: boolean
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

function addMenuItemSourceOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--display-name <name>', '自定义菜单项显示名称')
    .option('--href <url>', '自定义菜单项链接')
    .option('--ref-kind <kind>', '引用类型：post、page、category、tag 或 custom')
    .option('--ref-name <name>', '引用资源 metadata.name')
    .option('--target <target>', '链接目标：_self、_blank、_parent 或 _top')
}

export function normalizeMenuItemTarget(
  value: unknown,
  fallback: MenuItemTarget = '_self',
): MenuItemTarget {
  if (value === undefined) return fallback
  const text = textValue(value, '--target')
  const normalized = text?.trim().toLocaleLowerCase() ?? ''
  const aliases: Record<string, MenuItemTarget> = {
    blank: '_blank',
    parent: '_parent',
    self: '_self',
    top: '_top',
  }
  const target = aliases[normalized] ?? normalized
  if (!['_blank', '_parent', '_self', '_top'].includes(target)) {
    throw new CliError(`不支持的菜单项 target：${text ?? ''}。`)
  }
  return target as MenuItemTarget
}

export function normalizeMenuRefKind(value: unknown): MenuRefKind | 'custom' | undefined {
  if (value === undefined) return undefined
  const text = textValue(value, '--ref-kind')
  const normalized = text?.trim().toLocaleLowerCase().replace(/[-_\s]/g, '') ?? ''
  const kinds: Record<string, MenuRefKind | 'custom'> = {
    category: 'Category',
    custom: 'custom',
    page: 'SinglePage',
    post: 'Post',
    singlepage: 'SinglePage',
    tag: 'Tag',
  }
  const kind = kinds[normalized]
  if (!kind) {
    throw new CliError(`不支持的菜单项引用类型：${text ?? ''}。`)
  }
  return kind
}

function customSource(options: MenuOptions, current?: MenuItem) {
  const displayName =
    options.displayName !== undefined
      ? required(
          textValue(options.displayName, '--display-name'),
          '菜单项显示名称（--display-name）',
        )
      : current?.spec.displayName
  const href =
    options.href !== undefined
      ? required(textValue(options.href, '--href'), '菜单项链接（--href）')
      : current?.spec.href
  return {
    displayName: required(displayName, '菜单项显示名称（--display-name）'),
    href: required(href, '菜单项链接（--href）'),
  }
}

function referencedSource(kind: MenuRefKind, refName: unknown) {
  return {
    targetRef: {
      group: 'content.halo.run',
      kind,
      name: required(textValue(refName, '--ref-name'), '引用资源名称（--ref-name）'),
      version: 'v1alpha1',
    },
  }
}

export function buildMenu(displayName: unknown): Menu {
  return {
    apiVersion: 'v1alpha1',
    kind: 'Menu',
    metadata: { generateName: 'menu-', name: '' },
    spec: {
      displayName: required(
        textValue(displayName, '--display-name'),
        '菜单显示名称（--display-name）',
      ),
    },
  }
}

export function buildMenuItem(
  menuName: string,
  parent: string | undefined,
  priority: number,
  options: MenuOptions,
): MenuItem {
  const kind = normalizeMenuRefKind(options.refKind)
  if (options.refName !== undefined && !kind) {
    throw new CliError('--ref-name 必须与 --ref-kind 一起使用。')
  }
  if (kind === 'custom' && options.refName !== undefined) {
    throw new CliError('自定义菜单项不能使用 --ref-name。')
  }
  if (
    kind &&
    kind !== 'custom' &&
    (options.displayName !== undefined || options.href !== undefined)
  ) {
    throw new CliError('引用型菜单项不能同时使用 --display-name 或 --href。')
  }
  const source =
    kind && kind !== 'custom' ? referencedSource(kind, options.refName) : customSource(options)
  return {
    apiVersion: 'v1alpha1',
    kind: 'MenuItem',
    metadata: { generateName: 'menu-item-', name: '' },
    spec: {
      ...source,
      menuName,
      parent,
      priority,
      target: normalizeMenuItemTarget(options.target),
    },
  }
}

export function buildUpdatedMenuItem(current: MenuItem, options: MenuOptions): MenuItem {
  const requestedKind = normalizeMenuRefKind(options.refKind)
  let source: Pick<MenuItem['spec'], 'displayName' | 'href' | 'targetRef'>
  if (requestedKind === 'custom') {
    if (options.refName !== undefined) throw new CliError('自定义菜单项不能使用 --ref-name。')
    source = { ...customSource(options, current), targetRef: undefined }
  } else if (requestedKind) {
    if (options.displayName !== undefined || options.href !== undefined) {
      throw new CliError('引用型菜单项不能同时使用 --display-name 或 --href。')
    }
    source = {
      displayName: undefined,
      href: undefined,
      ...referencedSource(requestedKind, options.refName),
    }
  } else if (current.spec.targetRef) {
    if (options.displayName !== undefined || options.href !== undefined) {
      throw new CliError(
        '引用型菜单项不能直接修改显示名称或链接；请使用 --ref-kind custom 转为自定义菜单项。',
      )
    }
    const refName = textValue(options.refName, '--ref-name')?.trim() || current.spec.targetRef.name
    source = {
      displayName: undefined,
      href: undefined,
      targetRef: { ...current.spec.targetRef, name: refName },
    }
  } else {
    if (options.refName !== undefined) throw new CliError('--ref-name 必须与 --ref-kind 一起使用。')
    source = { ...customSource(options, current), targetRef: undefined }
  }
  return {
    ...current,
    spec: {
      ...current.spec,
      ...source,
      target: normalizeMenuItemTarget(options.target, current.spec.target ?? '_self'),
    },
  }
}

export function findMenuItemNode(
  tree: MenuItemTreeNode[],
  name: string,
): MenuItemTreeNode | undefined {
  for (const node of tree) {
    if (node.menuItem.metadata.name === name) return node
    const child = findMenuItemNode(node.children, name)
    if (child) return child
  }
  return undefined
}

export function collectMenuItemNames(node: MenuItemTreeNode): string[] {
  return [node.menuItem.metadata.name, ...node.children.flatMap(collectMenuItemNames)]
}

function siblingCount(tree: MenuItemTreeNode[], parent: string | undefined): number {
  if (!parent) return tree.length
  const node = findMenuItemNode(tree, parent)
  if (!node) throw new CliError(`父菜单项不存在于所选菜单：${parent}`)
  return node.children.length
}

function validateBefore(
  tree: MenuItemTreeNode[],
  parent: string | undefined,
  before: string | undefined,
) {
  if (!before) return
  const siblings = parent ? findMenuItemNode(tree, parent)?.children : tree
  if (!siblings?.some((node) => node.menuItem.metadata.name === before)) {
    throw new CliError(`--before 必须是目标父级下的同级菜单项：${before}`)
  }
}

async function listAllMenuItems(http: Awaited<ReturnType<typeof createHaloClient>>['http']) {
  return (
    await http.get<Page<MenuItem>>(menuPath('menuitems'), {
      params: { page: 0, size: 0 },
    })
  ).data.items
}

async function menuItemTree(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  menuName: string,
) {
  return (
    await http.get<MenuItemTreeNode[]>(consoleMenuItemPath('-', 'tree'), {
      params: { menuName },
    })
  ).data
}

async function cloneTree(
  http: Awaited<ReturnType<typeof createHaloClient>>['http'],
  nodes: MenuItemTreeNode[],
  menuName: string,
  createdNames: string[],
  parent?: string,
): Promise<void> {
  for (const node of nodes) {
    const original = node.menuItem
    const cloned: MenuItem = {
      apiVersion: 'v1alpha1',
      kind: 'MenuItem',
      metadata: {
        annotations: original.metadata.annotations,
        generateName: 'menu-item-',
        labels: original.metadata.labels,
        name: '',
      },
      spec: {
        ...original.spec,
        children: undefined,
        menuName,
        parent,
      },
    }
    const created = (await http.post<MenuItem>(menuPath('menuitems'), cloned)).data
    createdNames.push(created.metadata.name)
    await cloneTree(http, node.children, menuName, createdNames, created.metadata.name)
  }
}

export function registerMenuCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出菜单'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--keyword <keyword>', '按显示名称或 metadata.name 筛选')
    .option('--json', '输出 JSON')
    .action(async (options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const [menus, items, config] = await Promise.all([
        http.get<Page<Menu>>(menuPath('menus'), { params: { page: 0, size: 0 } }),
        listAllMenuItems(http),
        http.get<MenuSystemConfig>(systemConfigPath('menu')),
      ])
      const page = positiveInteger(options.page, 1)
      const size = positiveInteger(options.size, 50)
      const keyword = textValue(options.keyword, '--keyword')?.trim().toLocaleLowerCase() ?? ''
      const result = filterAndPaginate(
        menus.data.items,
        (menu) =>
          !keyword ||
          menu.metadata.name.toLocaleLowerCase().includes(keyword) ||
          menu.spec.displayName.toLocaleLowerCase().includes(keyword),
        page,
        size,
      )
      const counts = items.reduce<Record<string, number>>((values, item) => {
        if (item.spec.menuName) {
          values[item.spec.menuName] = (values[item.spec.menuName] ?? 0) + 1
        }
        return values
      }, {})
      printMenuList(result, config.data.primary, counts, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看菜单'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      printMenu((await http.get<Menu>(menuPath('menus', name))).data, options.json)
    })

  addConnectionOptions(cli.command('create', '创建菜单'))
    .option('--display-name <name>', '菜单显示名称')
    .option('--json', '输出 JSON')
    .action(async (options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const created = (await http.post<Menu>(menuPath('menus'), buildMenu(options.displayName))).data
      if (options.json) printJson(created)
      else process.stdout.write(`已创建菜单 ${created.metadata.name}。\n`)
    })

  addConnectionOptions(cli.command('update <name>', '更新菜单'))
    .option('--display-name <name>', '菜单显示名称')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const current = (await http.get<Menu>(menuPath('menus', name))).data
      const updated: Menu = {
        ...current,
        spec: {
          ...current.spec,
          displayName:
            options.displayName === undefined
              ? current.spec.displayName
              : required(
                  textValue(options.displayName, '--display-name'),
                  '菜单显示名称（--display-name）',
                ),
        },
      }
      const saved = (await http.put<Menu>(menuPath('menus', name), updated)).data
      if (options.json) printJson(saved)
      else process.stdout.write(`已更新菜单 ${name}。\n`)
    })

  addConnectionOptions(cli.command('clone <name>', '复制菜单及其完整菜单项树'))
    .option('--display-name <name>', '新菜单显示名称；默认沿用原名称')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const [current, tree] = await Promise.all([
        http.get<Menu>(menuPath('menus', name)),
        menuItemTree(http, name),
      ])
      const clonedMenu = buildMenu(options.displayName ?? current.data.spec.displayName)
      clonedMenu.metadata.annotations = current.data.metadata.annotations
      clonedMenu.metadata.labels = current.data.metadata.labels
      const created = (await http.post<Menu>(menuPath('menus'), clonedMenu)).data
      const createdItemNames: string[] = []
      try {
        await cloneTree(http, tree, created.metadata.name, createdItemNames)
      } catch (error) {
        try {
          await http.delete(consoleMenuPath(created.metadata.name))
          await waitForDeletion(http, menuPath('menus', created.metadata.name))
          for (const itemName of createdItemNames) {
            await waitForDeletion(http, menuPath('menuitems', itemName))
          }
        } catch (cleanupError) {
          const originalMessage = error instanceof Error ? error.message : String(error)
          const cleanupMessage =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          throw new CliError(
            `复制菜单失败，且自动回滚菜单 ${created.metadata.name} 失败。原始错误：${originalMessage}；回滚错误：${cleanupMessage}`,
          )
        }
        throw error
      }
      const itemCount = createdItemNames.length
      if (options.json) printJson({ itemCount, menu: created })
      else {
        process.stdout.write(
          `已复制菜单 ${name} 为 ${created.metadata.name}，包含 ${itemCount} 个菜单项。\n`,
        )
      }
    })

  addConnectionOptions(cli.command('primary', '查看当前主菜单'))
    .option('--json', '输出 JSON')
    .action(async (options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const config = (await http.get<MenuSystemConfig>(systemConfigPath('menu'))).data
      if (options.json) printJson(config)
      else process.stdout.write(`${config.primary ?? '-'}\n`)
    })

  addConnectionOptions(cli.command('set-primary <name>', '设置主菜单'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      await http.get<Menu>(menuPath('menus', name))
      await http.put(systemConfigPath('menu'), { primary: name })
      if (options.json) printJson({ primary: name })
      else process.stdout.write(`已将 ${name} 设置为主菜单。\n`)
    })

  addConnectionOptions(cli.command('tree <menu>', '查看菜单项树'))
    .option('--json', '输出 JSON')
    .action(async (menu: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const [, tree] = await Promise.all([
        http.get<Menu>(menuPath('menus', menu)),
        menuItemTree(http, menu),
      ])
      printMenuItemTree(tree, options.json)
    })

  addConnectionOptions(cli.command('item-get <name>', '查看菜单项'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      printMenuItem((await http.get<MenuItem>(menuPath('menuitems', name))).data, options.json)
    })

  addMenuItemSourceOptions(
    addConnectionOptions(cli.command('item-create', '创建菜单项'))
      .option('--menu <name>', '所属菜单 metadata.name')
      .option('--parent <name>', '父菜单项；空字符串表示根级')
      .option('--before <name>', '插入到指定同级菜单项之前'),
  )
    .option('--json', '输出 JSON')
    .action(async (options: MenuOptions) => {
      const menuName = required(textValue(options.menu, '--menu'), '所属菜单（--menu）')
      const parent = textValue(options.parent, '--parent')?.trim() || undefined
      const before = textValue(options.before, '--before')?.trim() || undefined
      const { http } = await createHaloClient(options)
      const [, tree] = await Promise.all([
        http.get<Menu>(menuPath('menus', menuName)),
        menuItemTree(http, menuName),
      ])
      validateBefore(tree, parent, before)
      const created = (
        await http.post<MenuItem>(
          menuPath('menuitems'),
          buildMenuItem(menuName, parent, siblingCount(tree, parent), options),
        )
      ).data
      let result = created
      if (before) {
        const positionedTree = (
          await http.put<MenuItemTreeNode[]>(
            consoleMenuItemPath(created.metadata.name, 'position'),
            {
              beforeName: before,
              menuName,
              parentName: parent,
            } satisfies MenuItemPositionRequest,
          )
        ).data
        result = findMenuItemNode(positionedTree, created.metadata.name)?.menuItem ?? created
      }
      if (options.json) printJson(result)
      else process.stdout.write(`已创建菜单项 ${created.metadata.name}。\n`)
    })

  addMenuItemSourceOptions(addConnectionOptions(cli.command('item-update <name>', '更新菜单项')))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const { http } = await createHaloClient(options)
      const current = (await http.get<MenuItem>(menuPath('menuitems', name))).data
      const updated = buildUpdatedMenuItem(current, options)
      const saved = (await http.put<MenuItem>(menuPath('menuitems', name), updated)).data
      if (options.json) printJson(saved)
      else process.stdout.write(`已更新菜单项 ${name}。\n`)
    })

  addConnectionOptions(cli.command('item-move <name>', '移动或重排菜单项'))
    .option('--menu <name>', '所属菜单 metadata.name')
    .option('--parent <name>', '目标父菜单项；空字符串表示根级')
    .option('--before <name>', '移动到指定同级菜单项之前；省略表示末尾')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      const menuName = required(textValue(options.menu, '--menu'), '所属菜单（--menu）')
      if (options.parent === undefined) {
        throw new CliError('item-move 必须显式提供 --parent；根级请使用 --parent ""。')
      }
      const parentName = textValue(options.parent, '--parent')?.trim() || undefined
      const beforeName = textValue(options.before, '--before')?.trim() || undefined
      const { http } = await createHaloClient(options)
      const moved = (
        await http.put<MenuItemTreeNode[]>(consoleMenuItemPath(name, 'position'), {
          beforeName,
          menuName,
          parentName,
        } satisfies MenuItemPositionRequest)
      ).data
      if (options.json) printJson(moved)
      else process.stdout.write(`已移动菜单项 ${name}。\n`)
    })

  addConnectionOptions(cli.command('item-delete <name>', '删除菜单项及其全部后代'))
    .option('--yes', '确认删除整棵菜单项子树')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      requireConfirmation(options.yes, `halo-cli menu item-delete ${name}`)
      const { http } = await createHaloClient(options)
      const item = (await http.get<MenuItem>(menuPath('menuitems', name))).data
      const menuName = item.spec.menuName
      if (!menuName) throw new CliError(`菜单项 ${name} 缺少 spec.menuName，无法安全解析其后代。`)
      const node = findMenuItemNode(await menuItemTree(http, menuName), name)
      if (!node) throw new CliError(`菜单项 ${name} 不在菜单 ${menuName} 的树中。`)
      const names = collectMenuItemNames(node)
      for (const itemName of [...names].reverse()) {
        const path = menuPath('menuitems', itemName)
        await http.delete(path)
        await waitForDeletion(http, path)
      }
      if (options.json) printJson({ deleted: true, names })
      else process.stdout.write(`已删除菜单项子树 ${name}，共 ${names.length} 个菜单项。\n`)
    })

  addConnectionOptions(cli.command('delete <name>', '删除菜单及其全部菜单项'))
    .option('--yes', '确认删除菜单及全部菜单项')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: MenuOptions) => {
      requireConfirmation(options.yes, `halo-cli menu delete ${name}`)
      const { http } = await createHaloClient(options)
      const [config, tree] = await Promise.all([
        http.get<MenuSystemConfig>(systemConfigPath('menu')),
        menuItemTree(http, name),
      ])
      if (config.data.primary === name) {
        throw new CliError(`不能删除当前主菜单 ${name}；请先运行 halo-cli menu set-primary <其他菜单>。`)
      }
      const itemNames = tree.flatMap((node) => collectMenuItemNames(node))
      await http.delete(consoleMenuPath(name))
      await waitForDeletion(http, menuPath('menus', name))
      for (const itemName of itemNames) {
        await waitForDeletion(http, menuPath('menuitems', itemName))
      }
      if (options.json) printJson({ deleted: true, itemNames, name })
      else process.stdout.write(`已删除菜单 ${name} 及 ${itemNames.length} 个菜单项。\n`)
    })
}
