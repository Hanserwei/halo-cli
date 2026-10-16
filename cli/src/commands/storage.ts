import axios, { type AxiosInstance } from 'axios'
import type { CAC } from 'cac'

import { createHaloClient, customExtensionPath, storagePath, waitForDeletion } from '../client.js'
import {
  addConfigurationConnectionOptions,
  addConfigurationOutputOptions,
  assertConfigurationPointer,
  configurationFields,
  printConfiguration,
  writeConfiguration,
} from '../configuration.js'
import type { ConfigurationOptions, ConfigurationTarget } from '../configuration.js'
import { CliError, toCliError } from '../errors.js'
import {
  containsRedactedValue,
  isJsonObject,
  mergeJsonObjects,
  parseJsonValue,
  readJsonObject,
  setJsonPointer,
} from '../json-input.js'
import { positiveInteger, required, requireConfirmation, textValue } from '../options.js'
import { printJson, printStoragePolicyList } from '../output.js'
import { printOrExportJson } from '../structured-output.js'
import type { Metadata, Page, Setting, StoragePolicy } from '../types.js'

export interface PolicyTemplate {
  apiVersion: 'storage.halo.run/v1alpha1'
  kind: 'PolicyTemplate'
  metadata: Metadata
  spec: { displayName: string; settingName?: string }
}

interface StorageOptions extends ConfigurationOptions {
  displayName?: unknown
  page?: string
  size?: string
  template?: unknown
}

const policyTemplatesPath = (name?: string) =>
  customExtensionPath('storage.halo.run', 'v1alpha1', 'policytemplates', name)

export function policyConfigurationPath(name: string): string {
  return `/apis/console.api.storage.halo.run/v1alpha1/policies/${encodeURIComponent(name)}/configs/default`
}

// Configuration responses may contain arbitrary S3 credentials. Never echo a server error body.
export async function storageRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (axios.isAxiosError(error)) {
      switch (error.response?.status) {
        case 400:
        case 422:
          throw new CliError(`存储请求参数或配置无效（HTTP ${error.response.status}），请按策略模板检查字段。`)
        case 404:
          throw new CliError('存储策略、模板或配置接口不存在（HTTP 404）；S3 策略需要安装并启用 S3 对象存储插件及兼容的 Halo 版本。')
        case 409:
          throw new CliError('存储资源冲突（HTTP 409）：名称已存在或版本已更新，请重新读取后重试。')
      }
      throw toCliError(error)
    }
    throw error
  }
}

export async function getStoragePolicy(http: AxiosInstance, name: string): Promise<StoragePolicy> {
  const policy = (await storageRequest(() => http.get<StoragePolicy>(storagePath('policies', name)))).data
  if (policy.metadata.deletionTimestamp) throw new CliError('存储策略正在删除，不能继续操作。')
  return policy
}

export async function getPolicyTemplate(http: AxiosInstance, name: string): Promise<PolicyTemplate> {
  return (await storageRequest(() => http.get<PolicyTemplate>(policyTemplatesPath(name)))).data
}

export function buildStoragePolicy(name: string, template: string, displayName: string): StoragePolicy {
  return {
    apiVersion: 'storage.halo.run/v1alpha1',
    kind: 'Policy',
    metadata: { name: required(name, '策略名称') },
    spec: {
      displayName: required(displayName, '显示名称（--display-name）'),
      templateName: required(template, '策略模板（--template）'),
    },
  }
}

export function updateStoragePolicy(current: StoragePolicy, displayName: unknown): StoragePolicy {
  if (current.metadata.version === undefined || current.metadata.version === null) {
    throw new CliError('策略没有 metadata.version，拒绝无版本更新，请重新读取。')
  }
  return {
    ...current,
    metadata: { ...current.metadata },
    spec: { ...current.spec, displayName: required(textValue(displayName, '--display-name'), '--display-name') },
  }
}

async function policySchema(http: AxiosInstance, policy: StoragePolicy): Promise<Setting> {
  const template = await getPolicyTemplate(http, required(policy.spec.templateName, '策略的 templateName'))
  const settingName = required(template.spec.settingName, '策略模板的 settingName')
  const schema = (await storageRequest(() => http.get<Setting>(`/api/v1alpha1/settings/${encodeURIComponent(settingName)}`))).data
  if (!schema.spec.forms.some((form) => isJsonObject(form) && form.group === 'default')) {
    throw new CliError('策略模板没有 default 配置组，无法使用此配置命令。')
  }
  // These commands write only the group consumed by the attachment handler.
  return { ...schema, spec: { ...schema.spec, forms: schema.spec.forms.filter((form) => isJsonObject(form) && form.group === 'default') } }
}

export async function assertExclusivePolicyConfiguration(http: AxiosInstance, policy: StoragePolicy): Promise<void> {
  const configMapName = policy.spec.configMapName
  if (configMapName === undefined || configMapName === null || configMapName === '') return
  if (typeof configMapName !== 'string' || !configMapName.trim()) throw new CliError('策略的 ConfigMap 关联无效。')
  // Halo's config endpoint updates the existing reference. Refuse known shared references
  // rather than changing another policy's credentials. No ConfigMap is rebound or deleted.
  for (let page = 1; ; page++) {
    const result = (await storageRequest(() => http.get<Page<StoragePolicy>>(storagePath('policies'), {
      params: { page, size: 100 },
    }))).data
    if (result.items.some((item) => item.metadata.name !== policy.metadata.name && item.spec.configMapName === configMapName)) {
      throw new CliError('此策略与其他策略共享 ConfigMap，拒绝修改配置；请先在 Halo 中修复关联。')
    }
    if (!result.hasNext) break
    if (result.items.length === 0) throw new CliError('策略列表分页异常，无法确认 ConfigMap 独占关联。')
  }
}

export async function loadStorageConfiguration(http: AxiosInstance, name: string): Promise<ConfigurationTarget> {
  const policy = await getStoragePolicy(http, name)
  const schema = await policySchema(http, policy)
  // Halo 2.27's config GET maps a missing configMapName through a non-null mapper.
  // An unbound policy is definitively empty; the transactional PUT creates its ConfigMap.
  const value: unknown = policy.spec.configMapName
    ? (await storageRequest(() => http.get<unknown>(policyConfigurationPath(name)))).data
    : null
  if (value !== null && !isJsonObject(value)) throw new CliError('策略配置不是 JSON 对象，拒绝覆盖。')
  return {
    label: '存储策略配置',
    schema,
    current: { default: value ?? {} },
    write: async (updated) => {
      await assertExclusivePolicyConfiguration(http, policy)
      if (Object.keys(updated).some((key) => key !== 'default') || !isJsonObject(updated.default)) {
        throw new CliError('存储策略配置必须只包含 default 配置组。')
      }
      // The server creates a ConfigMap and associates it with the Policy in a transaction.
      // A successful update returns 204; do not depend on a response body or perform a Policy PUT.
      await storageRequest(() => http.put(policyConfigurationPath(name), updated.default))
    },
  }
}

export function normalizeStorageConfiguration(value: Record<string, unknown>): Record<string, unknown> {
  if (containsRedactedValue(value)) throw new CliError('配置包含 [REDACTED]，拒绝覆盖真实凭据。')
  if (Object.hasOwn(value, 'default')) {
    if (Object.keys(value).length !== 1 || !isJsonObject(value.default)) {
      throw new CliError('存储策略配置必须只包含 default 对象。')
    }
    return value
  }
  return { default: value }
}

export function registerStorageCommands(cli: CAC): void {
  function command(name: string, description: string) {
    return addConfigurationConnectionOptions(cli.command(name, description))
  }
  command('templates', '列出可用存储策略模板（S3 需要对象存储插件）')
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--json', '输出 JSON')
    .action(async (options: StorageOptions) => {
      const { http } = await createHaloClient(options)
      const response = await storageRequest(() => http.get<Page<PolicyTemplate>>(policyTemplatesPath(), {
        params: { page: positiveInteger(options.page, 1), size: positiveInteger(options.size, 20) },
      }))
      printJson(response.data)
    })

  command('list', '列出存储策略')
    .option('--page <number>', '页码', { default: 1 })
    .option('--size <number>', '每页数量', { default: 20 })
    .option('--json', '输出 JSON')
    .action(async (options: StorageOptions) => {
      const { http } = await createHaloClient(options)
      const response = await storageRequest(() => http.get<Page<StoragePolicy>>(storagePath('policies'), {
        params: { page: positiveInteger(options.page, 1), size: positiveInteger(options.size, 20) },
      }))
      printStoragePolicyList(response.data, options.json)
    })

  command('get <name>', '查看存储策略及其模板和 ConfigMap 引用')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      const { http } = await createHaloClient(options)
      await printOrExportJson(await getStoragePolicy(http, name), { json: options.json }, '存储策略')
    })

  command('create <name>', '创建存储策略；随后使用 config-import 配置桶及凭据')
    .option('--template <name>', '模板 metadata.name，例如 s3os')
    .option('--display-name <name>', '显示名称')
    .option('--dry-run', '预检模板并显示策略，不创建')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      const proposed = buildStoragePolicy(name, required(textValue(options.template, '--template'), '--template'), required(textValue(options.displayName, '--display-name'), '--display-name'))
      const { http } = await createHaloClient(options)
      await getPolicyTemplate(http, proposed.spec.templateName!)
      if (options.dryRun) printJson({ dryRun: true, policy: proposed })
      else printJson((await storageRequest(() => http.post<StoragePolicy>(storagePath('policies'), proposed))).data)
    })

  command('update <name>', '更新策略显示名称，保留模板、配置关联和 metadata.version')
    .option('--display-name <name>', '新的显示名称')
    .option('--dry-run', '预览更新，不写入')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      required(textValue(options.displayName, '--display-name'), '--display-name')
      const { http } = await createHaloClient(options)
      const updated = updateStoragePolicy(await getStoragePolicy(http, name), options.displayName)
      if (options.dryRun) await printOrExportJson({ dryRun: true, policy: updated }, { json: options.json }, '存储策略')
      else await printOrExportJson((await storageRequest(() => http.put<StoragePolicy>(storagePath('policies', name), updated))).data, { json: options.json }, '存储策略')
    })

  command('delete <name>', '删除存储策略；不自行删除关联 ConfigMap 或 S3 对象')
    .option('--yes', '确认删除')
    .option('--dry-run', '预览删除，不写入')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      if (!options.dryRun) requireConfirmation(options.yes, `storage delete ${name}`)
      const { http } = await createHaloClient(options)
      await getStoragePolicy(http, name)
      if (options.dryRun) { printJson({ dryRun: true, name }); return }
      await storageRequest(() => http.delete(storagePath('policies', name)))
      await storageRequest(() => waitForDeletion(http, storagePath('policies', name)))
      printJson({ deleted: true, name })
    })

  command('config-fields <name>', '发现策略配置字段、JSON Pointer、必填项及选项')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      const { http } = await createHaloClient(options)
      const schema = await policySchema(http, await getStoragePolicy(http, name))
      printJson(configurationFields(schema).map((field) => field.sensitive && Object.hasOwn(field, 'default') ? { ...field, default: '[REDACTED]' } : field))
    })

  for (const readCommand of ['config', 'config-export']) {
    addConfigurationOutputOptions(command(`${readCommand} <name>`, '查看或导出策略配置，默认脱敏；包含 default 配置组'))
      .action(async (name: string, options: StorageOptions) => {
        if (readCommand === 'config-export') required(textValue(options.output, '--output'), '--output')
        const { http } = await createHaloClient(options)
        const target = await loadStorageConfiguration(http, name)
        await printConfiguration(target.current, target.schema, options, target.label)
      })
  }

  command('config-set <name> <pointer> <value>', '按 JSON Pointer 修改配置，例如 /default/region；值优先解析为 JSON')
    .option('--dry-run', '校验并显示脱敏配置，不写入')
    .option('--json', '输出 JSON')
    .action(async (name: string, pointer: string, value: string, options: StorageOptions) => {
      const { http } = await createHaloClient(options)
      const target = await loadStorageConfiguration(http, name)
      assertConfigurationPointer(pointer, target.schema)
      if (options.dryRun) await assertExclusivePolicyConfiguration(http, await getStoragePolicy(http, name))
      await writeConfiguration(target, setJsonPointer(target.current, pointer, parseJsonValue(value)), options)
    })

  command('config-import <name>', '从 JSON 文件合并或替换配置；支持 default 分组对象或裸策略配置')
    .option('--file <path>', '配置 JSON 文件')
    .option('--replace', '替换完整 default 配置，默认递归合并')
    .option('--yes', '确认完整替换')
    .option('--dry-run', '校验并显示脱敏配置，不写入')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: StorageOptions) => {
      const imported = normalizeStorageConfiguration(await readJsonObject(required(textValue(options.file, '--file'), '--file'), '存储配置文件'))
      if (options.replace && !options.dryRun) requireConfirmation(options.yes, 'storage config-import --replace')
      const { http } = await createHaloClient(options)
      const target = await loadStorageConfiguration(http, name)
      if (options.dryRun) await assertExclusivePolicyConfiguration(http, await getStoragePolicy(http, name))
      await writeConfiguration(target, options.replace ? imported : mergeJsonObjects(target.current, imported), options)
    })
}
