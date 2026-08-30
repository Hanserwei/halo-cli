import type { CAC } from 'cac'

import { createHaloClient } from '../client.js'
import { booleanValue, csv, positiveInteger } from '../options.js'
import { printJson } from '../output.js'
import type { ConnectionOptions } from '../types.js'

interface SearchOptions extends ConnectionOptions {
  categories?: unknown
  filterExposed?: boolean | string
  filterPublished?: boolean | string
  filterRecycled?: boolean | string
  json?: boolean
  limit?: string
  owners?: unknown
  tags?: unknown
  types?: unknown
}

interface SearchDocument {
  content: string
  id: string
  metadataName: string
  ownerName: string
  permalink: string
  title: string
  type: string
}

interface SearchResult {
  hits: SearchDocument[]
  keyword: string
  limit: number
  processingTimeMillis: number
  total: number
}

function addConnectionOptions(command: ReturnType<CAC['command']>) {
  return command
    .option('--profile <name>', '使用指定连接')
    .option('--url <url>', '临时 Halo 地址（需同时提供 --token）')
    .option('--token <token>', '临时个人令牌（需同时提供 --url）')
}

export function registerSearchCommands(cli: CAC): void {
  addConnectionOptions(cli.command('query <keyword>', '通过 Halo 搜索索引查询内容'))
    .option('--limit <number>', '最大结果数', { default: 20 })
    .option('--types <types>', '内容类型，多个值用逗号分隔')
    .option('--categories <names>', '分类 metadata.name，多个值用逗号分隔')
    .option('--tags <names>', '标签 metadata.name，多个值用逗号分隔')
    .option('--owners <names>', '作者 metadata.name，多个值用逗号分隔')
    .option('--filter-published <boolean>', '仅返回已发布内容，true 或 false（默认 true）')
    .option('--filter-recycled <boolean>', '过滤回收站内容，true 或 false（默认 true）')
    .option('--filter-exposed <boolean>', '仅返回公开内容，true 或 false（默认 true）')
    .option('--json', '输出 JSON')
    .action(async (keyword: string, options: SearchOptions) => {
      const { http } = await createHaloClient(options)
      const response = await http.post<SearchResult>('/apis/api.halo.run/v1alpha1/indices/-/search', {
        filterExposed: booleanValue(options.filterExposed, '--filter-exposed') ?? true,
        filterPublished: booleanValue(options.filterPublished, '--filter-published') ?? true,
        filterRecycled: booleanValue(options.filterRecycled, '--filter-recycled') ?? true,
        includeCategoryNames: csv(options.categories, '--categories'),
        includeOwnerNames: csv(options.owners, '--owners'),
        includeTagNames: csv(options.tags, '--tags'),
        includeTypes: csv(options.types, '--types'),
        keyword,
        limit: positiveInteger(options.limit, 20),
      })
      if (options.json) {
        printJson(response.data)
        return
      }
      for (const hit of response.data.hits ?? []) {
        process.stdout.write(`${hit.type.padEnd(14)} ${hit.title}\n  ${hit.permalink}\n`)
      }
      process.stdout.write(
        `共 ${response.data.total ?? response.data.hits?.length ?? 0} 条结果，耗时 ${response.data.processingTimeMillis ?? 0} ms\n`,
      )
    })
}
