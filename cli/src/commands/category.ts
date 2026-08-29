import type { CAC } from 'cac'

import { createHaloClient, resourcePath, waitForDeletion } from '../client.js'
import { integer, positiveInteger, required, requireConfirmation, slugify } from '../options.js'
import { printCategoryList, printJson, printResource } from '../output.js'
import { filterAndPaginate } from '../pagination.js'
import type { Category, ConnectionOptions, OutputOptions, Page } from '../types.js'

interface CategoryOptions extends ConnectionOptions, OutputOptions {
  cover?: string
  description?: string
  displayName?: string
  keyword?: string
  page?: string
  parent?: string
  priority?: string
  size?: string
  slug?: string
  sort?: string
  yes?: boolean
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

export function buildCategory(options: CategoryOptions): Category {
  const displayName = required(options.displayName, '分类名称（--display-name）')
  return {
    apiVersion: 'content.halo.run/v1alpha1',
    kind: 'Category',
    metadata: { generateName: 'category-', name: '' },
    spec: {
      cover: options.cover?.trim() || undefined,
      description: options.description?.trim() || undefined,
      displayName,
      parent: options.parent?.trim() || undefined,
      priority: integer(options.priority),
      slug: options.slug?.trim() || slugify(displayName, 'category'),
    },
  }
}

export function registerCategoryCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出分类'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--keyword <keyword>', '按显示名称精确筛选')
    .option('--sort <sort>', '排序，例如 spec.priority,desc')
    .option('--json', '输出 JSON')
    .action(async (options: CategoryOptions) => {
      const { http } = await createHaloClient(options)
      const page = positiveInteger(options.page, 1)
      const size = positiveInteger(options.size, 50)
      const keyword = options.keyword?.trim().toLocaleLowerCase()
      const response = await http.get<Page<Category>>(resourcePath('categories'), {
        params: {
          page: keyword ? 0 : page,
          size: keyword ? 0 : size,
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
        },
      })
      const result = keyword
        ? filterAndPaginate(
            response.data.items,
            (category) => category.spec.displayName.toLocaleLowerCase().includes(keyword),
            page,
            size,
          )
        : response.data
      printCategoryList(result, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看分类'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: CategoryOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Category>(resourcePath('categories', name))
      printResource(response.data, options.json)
    })

  addConnectionOptions(cli.command('create', '创建分类'))
    .option('--display-name <name>', '分类显示名称')
    .option('--slug <slug>', '分类别名')
    .option('--description <text>', '分类描述')
    .option('--cover <url>', '封面地址')
    .option('--parent <name>', '父分类 metadata.name')
    .option('--priority <number>', '排序优先级')
    .option('--json', '输出 JSON')
    .action(async (options: CategoryOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.post<Category>(resourcePath('categories'), buildCategory(options))
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已创建分类 ${response.data.metadata.name}。\n`)
      }
    })

  addConnectionOptions(cli.command('update <name>', '更新分类'))
    .option('--display-name <name>', '分类显示名称')
    .option('--slug <slug>', '分类别名')
    .option('--description <text>', '分类描述')
    .option('--cover <url>', '封面地址')
    .option('--parent <name>', '父分类 metadata.name')
    .option('--priority <number>', '排序优先级')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: CategoryOptions) => {
      const { http } = await createHaloClient(options)
      const current = (await http.get<Category>(resourcePath('categories', name))).data
      const updated: Category = {
        ...current,
        spec: {
          ...current.spec,
          cover: options.cover !== undefined ? options.cover.trim() || undefined : current.spec.cover,
          description:
            options.description !== undefined
              ? options.description.trim() || undefined
              : current.spec.description,
          displayName: options.displayName?.trim() || current.spec.displayName,
          parent:
            options.parent !== undefined ? options.parent.trim() || undefined : current.spec.parent,
          priority:
            options.priority !== undefined ? integer(options.priority) : current.spec.priority,
          slug: options.slug?.trim() || current.spec.slug,
        },
      }
      const response = await http.put<Category>(resourcePath('categories', name), updated)
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已更新分类 ${response.data.metadata.name}。\n`)
      }
    })

  addConnectionOptions(cli.command('delete <name>', '删除分类'))
    .option('--yes', '确认删除')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: CategoryOptions) => {
      requireConfirmation(options.yes, `halo-cli category delete ${name}`)
      const { http } = await createHaloClient(options)
      const path = resourcePath('categories', name)
      await http.delete(path)
      await waitForDeletion(http, path)
      if (options.json) {
        printJson({ deleted: true, name })
      } else {
        process.stdout.write(`已删除分类 ${name}。\n`)
      }
    })
}
