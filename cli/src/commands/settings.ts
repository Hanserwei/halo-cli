import type { AxiosInstance } from 'axios'
import type { CAC, Command } from 'cac'

import { createHaloClient, systemConfigPath } from '../client.js'
import {
  addConfigurationConnectionOptions,
  addConfigurationOutputOptions,
  assertConfigurationPointer,
  configurationReset,
  configurationFields,
  configurationForms,
  printConfiguration,
  redactConfigurationSchema,
  writeConfiguration,
} from '../configuration.js'
import type { ConfigurationOptions, ConfigurationTarget } from '../configuration.js'
import { CliError } from '../errors.js'
import { containsRedactedValue, isJsonObject, mergeJsonObjects, parseJsonValue, readJsonObject, setJsonPointer } from '../json-input.js'
import { required, requireConfirmation, textValue } from '../options.js'
import { printOrExportJson } from '../structured-output.js'
import type { Setting } from '../types.js'

interface SettingsOptions extends ConfigurationOptions {
  fields?: boolean
}

async function loadSystemSchema(http: AxiosInstance): Promise<Setting> {
  const schema = (await http.get<Setting>('/api/v1alpha1/settings/system')).data
  configurationFields(schema)
  return schema
}

function selectSchema(schema: Setting, group?: string): Setting {
  if (!group) return schema
  const forms = configurationForms(schema).filter((form) => form.group === group)
  if (!forms.length) throw new CliError(`系统 Schema 中没有分组：${group}。请先运行 settings list。`)
  return { ...schema, spec: { ...schema.spec, forms } }
}

async function loadSystemConfiguration(http: AxiosInstance, schema: Setting): Promise<ConfigurationTarget> {
  const current: Record<string, unknown> = {}
  for (const form of configurationForms(schema)) {
    const group = form.group as string
    const value: unknown = (await http.get<Record<string, unknown>>(systemConfigPath(group))).data ?? {}
    if (!isJsonObject(value)) throw new CliError(`系统配置 ${group} 必须是 JSON 对象。`)
    current[group] = value
  }
  return {
    label: '系统配置', schema, current,
    write: async (value) => {
      // The group endpoint replaces one group and preserves all other system groups.
      for (const [group, entry] of Object.entries(value)) {
        await http.put(systemConfigPath(group), entry)
      }
    },
  }
}

export function registerSettingsCommands(cli: CAC): void {
  function command(name: string, description: string): Command {
    return addConfigurationConnectionOptions(cli.command(name, description))
  }

  addConfigurationOutputOptions(command('list', '列出系统 Schema 中的所有设置分组'))
    .action(async (options: SettingsOptions) => {
      const { http } = await createHaloClient(options)
      const schema = await loadSystemSchema(http)
      const fields = configurationFields(schema)
      await printOrExportJson(configurationForms(schema).map((form) => ({
        group: form.group,
        label: form.label,
        fields: fields.filter((field) => field.group === form.group).length,
      })), options, '系统设置分组')
    })

  addConfigurationOutputOptions(command('schema [group]', '查看全部或指定分组的系统设置 Schema'))
    .option('--fields', '显示可写字段、JSON Pointer、类型及默认值')
    .action(async (group: string | undefined, options: SettingsOptions) => {
      const { http } = await createHaloClient(options)
      const schema = selectSchema(await loadSystemSchema(http), group)
      const safeSchema = options.includeSecrets ? schema : redactConfigurationSchema(schema)
      await printOrExportJson(options.fields ? configurationFields(safeSchema) : safeSchema, options, '系统设置 Schema')
    })

  for (const name of ['get', 'export']) {
    addConfigurationOutputOptions(command(`${name} [group]`, '读取或导出全部或指定分组的系统配置'))
      .action(async (group: string | undefined, options: SettingsOptions) => {
        if (name === 'export') required(textValue(options.output, '--output'), '--output')
        const { http } = await createHaloClient(options)
        const schema = selectSchema(await loadSystemSchema(http), group)
        const target = await loadSystemConfiguration(http, schema)
        // Always preserve the group envelope, including when selecting a single group.
        await printConfiguration(target.current, schema, options, '系统配置')
      })
  }

  command('set <group> <pointer> <value>', '按组内 JSON Pointer 修改系统设置字段')
    .option('--dry-run', '校验并显示脱敏差异，不写入')
    .option('--json', '输出 JSON')
    .action(async (group: string, pointer: string, value: string, options: SettingsOptions) => {
      const { http } = await createHaloClient(options)
      const schema = selectSchema(await loadSystemSchema(http), group)
      const target = await loadSystemConfiguration(http, schema)
      const fullPointer = `/${group}${pointer}`
      assertConfigurationPointer(fullPointer, schema)
      const updated = setJsonPointer(target.current, fullPointer, parseJsonValue(value))
      await writeConfiguration(target, updated, options)
    })

  command('import [group]', '合并或替换 JSON 配置；文件顶层保留分组名称')
    .option('--file <path>', '配置 JSON 文件')
    .option('--replace', '完整替换文件中指定的分组；默认递归合并')
    .option('--yes', '确认完整替换')
    .option('--dry-run', '校验并显示脱敏差异，不写入')
    .option('--json', '输出 JSON')
    .action(async (group: string | undefined, options: SettingsOptions) => {
      const imported = await readJsonObject(required(textValue(options.file, '--file'), '--file'), '系统配置文件')
      if (containsRedactedValue(imported)) throw new CliError('配置包含 [REDACTED]，拒绝写入以免覆盖真实凭据。')
      if (!Object.keys(imported).length) throw new CliError('配置文件没有包含任何系统分组。')
      if (options.replace && !options.dryRun) requireConfirmation(options.yes, 'settings import --replace')
      const { http } = await createHaloClient(options)
      const fullSchema = await loadSystemSchema(http)
      const groups = Object.keys(imported)
      for (const name of groups) {
        selectSchema(fullSchema, name)
        if (group && name !== group) throw new CliError(`导入文件包含所选分组以外的数据：${name}`)
        if (!isJsonObject(imported[name])) throw new CliError(`系统配置 ${name} 必须是 JSON 对象。`)
      }
      const schema = group ? selectSchema(fullSchema, group) : {
        ...fullSchema,
        spec: { ...fullSchema.spec, forms: configurationForms(fullSchema).filter((form) => groups.includes(form.group as string)) },
      }
      const target = await loadSystemConfiguration(http, schema)
      await writeConfiguration(target, options.replace ? imported : mergeJsonObjects(target.current, imported), options)
    })

  command('reset [group]', '将全部或指定系统分组恢复为 Schema 默认值')
    .option('--yes', '确认重置')
    .option('--dry-run', '显示默认值和脱敏差异，不写入')
    .option('--json', '输出 JSON')
    .action(async (group: string | undefined, options: SettingsOptions) => {
      if (!options.dryRun) requireConfirmation(options.yes, 'settings reset')
      const { http } = await createHaloClient(options)
      const schema = selectSchema(await loadSystemSchema(http), group)
      const target = await loadSystemConfiguration(http, schema)
      await writeConfiguration(target, configurationReset(schema, target.current), options)
    })
}
