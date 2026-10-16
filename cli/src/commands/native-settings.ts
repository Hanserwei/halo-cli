import axios from 'axios'
import type { CAC } from 'cac'

import { createHaloClient } from '../client.js'
import { addConfigurationConnectionOptions, addConfigurationOutputOptions, assertConfigurationPointer, configurationFields, printConfiguration, writeConfiguration } from '../configuration.js'
import type { ConfigurationOptions, ConfigurationTarget } from '../configuration.js'
import { CliError } from '../errors.js'
import { isJsonObject, mergeJsonObjects, parseJsonValue, readJsonObject, setJsonPointer } from '../json-input.js'
import { required, requireConfirmation, textValue } from '../options.js'
import { printJson } from '../output.js'
import type { HaloConnection } from '../client.js'
import type { Setting } from '../types.js'

interface SettingReference { name: string; group: string }
interface ConfigurableDescriptor {
  metadata: { name: string }
  spec: { senderSettingRef?: SettingReference; settingRef?: SettingReference; configMapRef?: { name: string } }
}
interface ConfigMapResource {
  apiVersion: string
  kind: string
  metadata: { name: string; version?: number }
  data?: Record<string, string>
}

const notifierResources = '/apis/notification.halo.run/v1alpha1/notifierDescriptors'
const authResources = '/apis/auth.halo.run/v1alpha1/authproviders'
const consoleBase = '/apis/api.console.halo.run/v1alpha1'

async function loadNativeConfiguration(connection: HaloConnection, kind: 'notifier' | 'auth-provider', name: string): Promise<ConfigurationTarget> {
  const { http } = connection
  const descriptor = (await http.get<ConfigurableDescriptor>(`${kind === 'notifier' ? notifierResources : authResources}/${encodeURIComponent(name)}`)).data
  const ref = kind === 'notifier' ? descriptor.spec.senderSettingRef : descriptor.spec.settingRef
  if (!ref?.name || !ref.group) throw new CliError('此提供者未声明可配置的 Setting。')
  const complete = (await http.get<Setting>(`/api/v1alpha1/settings/${encodeURIComponent(ref.name)}`)).data
  const schema: Setting = { ...complete, spec: { ...complete.spec, forms: complete.spec.forms.filter((form) => isJsonObject(form) && form.group === ref.group) } }
  if (!schema.spec.forms.length) throw new CliError('Setting 中未找到提供者声明的配置组。')
  if (kind === 'notifier') {
    const path = `${consoleBase}/notifiers/${encodeURIComponent(name)}/sender-config`
    const current: unknown = (await http.get(path)).data ?? {}
    if (!isJsonObject(current)) throw new CliError('通知器配置不是 JSON 对象。')
    return { label: '通知器配置', schema, current: { [ref.group]: current }, write: async (value) => { await http.post(path, value[ref.group]) } }
  }
  const mapName = descriptor.spec.configMapRef?.name
  if (!mapName) throw new CliError('认证提供者未声明 configMapRef。')
  // Identity configuration follows native ConfigMap RBAC. The CLI key intentionally has no
  // arbitrary ConfigMap scope; use a Halo PAT with the corresponding configuration role.
  const authorization = http.defaults.headers.Authorization
  if (typeof authorization === 'string' && /^Bearer\s+hcli_/iu.test(authorization)) {
    throw new CliError('认证提供者参数需使用具有 ConfigMap 权限的 Halo PAT；CLI 密钥不开放原始 ConfigMap。')
  }
  const path = `/api/v1alpha1/configmaps/${encodeURIComponent(mapName)}`
  let snapshot: ConfigMapResource | undefined
  try { snapshot = (await http.get<ConfigMapResource>(path)).data }
  catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error }
  const raw = snapshot?.data?.[ref.group]
  const current: unknown = raw ? JSON.parse(raw) : {}
  if (!isJsonObject(current)) throw new CliError('认证提供者配置不是 JSON 对象。')
  return {
    label: '认证提供者配置', schema, current: { [ref.group]: current },
    write: async (value) => {
      // Preserve the version read with the proposal. A concurrent edit must return 409.
      const data = { ...snapshot?.data, [ref.group]: JSON.stringify(value[ref.group]) }
      if (snapshot) await http.put(path, { ...snapshot, data })
      else await http.post('/api/v1alpha1/configmaps', { apiVersion: 'v1alpha1', kind: 'ConfigMap', metadata: { name: mapName }, data })
    },
  }
}

function registerNativeConfiguration(cli: CAC, kind: 'notifier' | 'auth-provider'): void {
  for (const operation of ['config', 'config-fields', 'config-export']) {
    addConfigurationOutputOptions(addConfigurationConnectionOptions(cli.command(`${operation} <name>`, '读取提供者配置及 Schema 字段，默认脱敏')))
      .action(async (name: string, options: ConfigurationOptions) => {
        if (operation === 'config-export') required(textValue(options.output, '--output'), '--output')
        const target = await loadNativeConfiguration(await createHaloClient(options), kind, name)
        if (operation === 'config-fields') {
          const safe = configurationFields(target.schema).map((field) => field.sensitive && Object.hasOwn(field, 'default') ? { ...field, default: '[REDACTED]' } : field)
          printJson(safe)
        } else await printConfiguration(target.current, target.schema, options, target.label)
      })
  }
  addConfigurationConnectionOptions(cli.command('config-set <name> <pointer> <value>', '按 Schema JSON Pointer 修改一个提供者字段'))
    .option('--dry-run', '预览脱敏变更，不保存')
    .option('--json', '输出 JSON')
    .action(async (name: string, pointer: string, value: string, options: ConfigurationOptions) => {
      const target = await loadNativeConfiguration(await createHaloClient(options), kind, name)
      assertConfigurationPointer(pointer, target.schema)
      await writeConfiguration(target, setJsonPointer(target.current, pointer, parseJsonValue(value)), options)
    })
  addConfigurationConnectionOptions(cli.command('config-import <name>', '从文件合并提供者配置，保留未传入的字段'))
    .option('--file <path>', 'JSON 配置文件，顶层包含 Schema group')
    .option('--replace', '完整替换所选组')
    .option('--yes', '确认完整替换')
    .option('--dry-run', '预览脱敏变更，不保存')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ConfigurationOptions) => {
      const incoming = await readJsonObject(required(textValue(options.file, '--file'), '--file'), '提供者配置')
      if (options.replace && !options.dryRun) requireConfirmation(options.yes, `${kind} config-import --replace`)
      const target = await loadNativeConfiguration(await createHaloClient(options), kind, name)
      const groups = Object.keys(target.current)
      if (Object.keys(incoming).some((group) => !groups.includes(group))) throw new CliError('配置文件包含提供者未声明的组。')
      await writeConfiguration(target, options.replace ? incoming : mergeJsonObjects(target.current, incoming), options)
    })
}

export function registerNotifierCommands(cli: CAC): void {
  registerNativeConfiguration(cli, 'notifier')
  addConfigurationConnectionOptions(cli.command('list', '发现通知发送器和配置引用'))
    .option('--json', '输出 JSON')
    .action(async (options: ConfigurationOptions) => {
      const { http } = await createHaloClient(options)
      printJson((await http.get(notifierResources)).data)
    })
  addConfigurationConnectionOptions(cli.command('verify <name>', '使用配置文件测试 SMTP；会向当前用户发送邮件'))
    .option('--file <path>', 'SMTP 配置 JSON 文件，裸对象或 sender 组')
    .option('--yes', '确认真实发送测试邮件')
    .option('--json', '输出 JSON')
    .action(async (name: string, options: ConfigurationOptions) => {
      if (name !== 'default-email-notifier') throw new CliError('此测试接口只支持 default-email-notifier。')
      requireConfirmation(options.yes, 'notifier verify default-email-notifier')
      const input = await readJsonObject(required(textValue(options.file, '--file'), '--file'), 'SMTP 配置')
      const config = isJsonObject(input.sender) ? input.sender : input
      const { http } = await createHaloClient(options)
      await http.post('/apis/console.api.notification.halo.run/v1alpha1/notifiers/default-email-notifier/verify-connection', config)
      printJson({ submitted: true, name })
    })
}

export function registerAuthProviderCommands(cli: CAC): void {
  registerNativeConfiguration(cli, 'auth-provider')
  addConfigurationConnectionOptions(cli.command('list', '查询认证提供者启用状态和顺序'))
    .option('--json', '输出 JSON')
    .action(async (options: ConfigurationOptions) => {
      const { http } = await createHaloClient(options)
      printJson((await http.get(`${consoleBase}/auth-providers`)).data)
    })
  for (const operation of ['enable', 'disable']) {
    addConfigurationConnectionOptions(cli.command(`${operation} <name>`, '启用或停用认证提供者'))
      .option('--yes', '确认更改登录方式')
      .option('--json', '输出 JSON')
      .action(async (name: string, options: ConfigurationOptions) => {
        requireConfirmation(options.yes, `auth-provider ${operation} ${name}`)
        const { http } = await createHaloClient(options)
        printJson((await http.put(`${consoleBase}/auth-providers/${encodeURIComponent(name)}/${operation}`)).data)
      })
  }
}
