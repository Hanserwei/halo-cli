import type { CAC } from 'cac'

import { createHaloClient, resourcePath, waitForDeletion } from '../client.js'
import { CliError } from '../errors.js'
import { positiveInteger, required, requireConfirmation, slugify } from '../options.js'
import { printJson, printResource, printTagList } from '../output.js'
import { filterAndPaginate } from '../pagination.js'
import type { ConnectionOptions, OutputOptions, Page, Tag } from '../types.js'

interface TagOptions extends ConnectionOptions, OutputOptions {
  color?: string
  cover?: string
  description?: string
  displayName?: string
  keyword?: string
  page?: string
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

function color(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (normalized && !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(normalized)) {
    throw new CliError('标签颜色必须是 #fff 或 #ffffff 格式。')
  }
  return normalized || undefined
}

export function buildTag(options: TagOptions): Tag {
  const displayName = required(options.displayName, '标签名称（--display-name）')
  return {
    apiVersion: 'content.halo.run/v1alpha1',
    kind: 'Tag',
    metadata: { generateName: 'tag-', name: '' },
    spec: {
      color: color(options.color),
      cover: options.cover?.trim() || undefined,
      description: options.description?.trim() || undefined,
      displayName,
      slug: options.slug?.trim() || slugify(displayName, 'tag'),
    },
  }
}

export function registerTagCommands(cli: CAC): void {
  addConnectionOptions(cli.command('list', '列出标签'))
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 50 })
    .option('--keyword <keyword>', '按显示名称精确筛选')
    .option('--sort <sort>', '排序，例如 metadata.creationTimestamp,desc')
    .option('--json', '输出 JSON')
    .action(async (options: TagOptions) => {
      const { http } = await createHaloClient(options)
      const page = positiveInteger(options.page, 1)
      const size = positiveInteger(options.size, 50)
      const keyword = options.keyword?.trim().toLocaleLowerCase()
      const response = await http.get<Page<Tag>>(resourcePath('tags'), {
        params: {
          page: keyword ? 0 : page,
          size: keyword ? 0 : size,
          sort: options.sort?.trim() ? [options.sort.trim()] : undefined,
        },
      })
      const result = keyword
        ? filterAndPaginate(
            response.data.items,
            (tag) => tag.spec.displayName.toLocaleLowerCase().includes(keyword),
            page,
            size,
          )
        : response.data
      printTagList(result, options.json)
    })

  addConnectionOptions(cli.command('get <name>', '查看标签'))
    .option('--json', '输出 JSON')
    .action(async (name: string, options: TagOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.get<Tag>(resourcePath('tags', name))
      printResource(response.data, options.json)
    })

  addConnectionOptions(cli.command('create', '创建标签'))
    .option('--display-name <name>', '标签显示名称')
    .option('--slug <slug>', '标签别名')
    .option('--description <text>', '标签描述')
    .option('--color <color>', '标签颜色，例如 #1890ff')
    .option('--cover <url>', '封面地址')
    .option('--json', '输出 JSON')
    .action(async (options: TagOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.post<Tag>(resourcePath('tags'), buildTag(options))
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已创建标签 ${response.data.metadata.name}。\n`)
      }
    })

  addConnectionOptions(cli.command('update <name>', '更新标签'))
    .option('--display-name <name>', '标签显示名称')
    .option('--slug <slug>', '标签别名')
    .option('--description <text>', '标签描述')
    .option('--color <color>', '标签颜色，例如 #1890ff')
    .option('--cover <url>', '封面地址')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: TagOptions) => {
      const { http } = await createHaloClient(options)
      const current = (await http.get<Tag>(resourcePath('tags', name))).data
      const updated: Tag = {
        ...current,
        spec: {
          ...current.spec,
          color: options.color !== undefined ? color(options.color) : current.spec.color,
          cover: options.cover !== undefined ? options.cover.trim() || undefined : current.spec.cover,
          description:
            options.description !== undefined
              ? options.description.trim() || undefined
              : current.spec.description,
          displayName: options.displayName?.trim() || current.spec.displayName,
          slug: options.slug?.trim() || current.spec.slug,
        },
      }
      const response = await http.put<Tag>(resourcePath('tags', name), updated)
      if (options.json) {
        printJson(response.data)
      } else {
        process.stdout.write(`已更新标签 ${response.data.metadata.name}。\n`)
      }
    })

  addConnectionOptions(cli.command('delete <name>', '删除标签'))
    .option('--yes', '确认删除')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: TagOptions) => {
      requireConfirmation(options.yes, `halo-cli tag delete ${name}`)
      const { http } = await createHaloClient(options)
      const path = resourcePath('tags', name)
      await http.delete(path)
      await waitForDeletion(http, path)
      if (options.json) {
        printJson({ deleted: true, name })
      } else {
        process.stdout.write(`已删除标签 ${name}。\n`)
      }
    })
}
