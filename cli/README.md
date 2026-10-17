# @hanserwei/halo-cli

`1.0.0-rc.1` 面向 Halo `2.27+`，运行时需要 Node.js `20.19+`。插件提供不依赖本地 `node_modules` 的 `halo-cli.cjs` 单文件。

## 连接

在 Halo Console 的「工具 / Halo CLI」创建专用访问密钥，然后通过标准输入保存连接：

```bash
read -rsp "Halo CLI key: " HALO_CLI_TOKEN
printf '\n'
printf '%s' "$HALO_CLI_TOKEN" | halo-cli auth login \
  --url https://your-halo.example --profile production --token-stdin
unset HALO_CLI_TOKEN
```

PAT 和已保存的 Profile 继续可用。显式 URL/token、环境变量 `HALO_BASE_URL/HALO_TOKEN` 各自必须完整提供，不跨来源拼接。所有资源命令支持 `--profile`，查询和写入支持 `--json`。`auth logout` 仅删除本地连接；服务端密钥在 Console 中管理。

## 站点与主题配置

```bash
halo-cli settings list --json
halo-cli settings schema basic --fields --json
halo-cli settings set basic /title "我的站点" --dry-run --json
halo-cli settings set basic /title "我的站点" --json
halo-cli settings export --output site-settings.json
halo-cli settings import --file site-settings.json --dry-run --json

halo-cli hanlo doctor --json
halo-cli hanlo config-fields --json
halo-cli hanlo config-set /equipment/bigTitle "我的装备" --dry-run --json
halo-cli hanlo config-export --output hanlo.json
halo-cli hanlo config-import --file hanlo.json --dry-run --json

halo-cli plugin config-fields han-equipment --json
halo-cli plugin config-set PluginPhotos /base/policyName s3-main --json
halo-cli theme config-fields theme-hanlo --json
```

配置字段来自站点实际 Setting，支持嵌套 group、array、repeater 和动态条件字段。局部修改和默认导入保留未传入的字段；整体替换需要 `--replace --yes`。`--dry-run` 输出脱敏差异而不写入。重置需要 `--yes`，保留无默认值的必填现值。导出默认脱敏，含 `[REDACTED]` 的配置文件不能直接回写。

`notifier` 管理原生通知发送器配置，`auth-provider` 管理认证提供者状态和参数。SMTP `verify` 会真实发送测试邮件，要求 `--yes`。认证提供者参数操作需要具有原生 ConfigMap 权限的 PAT；专用 CLI 密钥不开放任意 ConfigMap。

## 内容插件

```bash
halo-cli equipment schema --json
halo-cli equipment groups --json
halo-cli equipment create --file equipment.json --json
halo-cli moment create --content "一条瞬间" --visible PRIVATE --json # 归属当前登录用户
halo-cli photo upload --file image.png --group <photo-group-name> --json
halo-cli link list --json
halo-cli link application-list --json
```

装备使用 `han-equipment` 的独立 GVK；参数是允许重复标签的有序数组。资源创建和更新可以使用完整资源或裸 spec JSON。资源地址使用 `--resource-url`，连接地址使用 `--url`。图库上传沿用插件配置的 `base.policyName`，并通过业务接口提取 EXIF；图库分组删除默认保留图片。

## S3 存储策略

```bash
halo-cli storage templates --json
halo-cli storage create s3-main --template s3os --display-name "对象存储" --json
halo-cli storage config-fields s3-main --json
halo-cli storage config-import s3-main --file s3-policy.json --dry-run --json
halo-cli storage config-import s3-main --file s3-policy.json --json
halo-cli attachment upload --file image.png --policy s3-main --preflight --json
```

S3 策略文件接受 `{"default": {...}}` 或裸对象，字段以策略 Setting 为准。凭据应通过私有文件输入，未脱敏导出需 `--include-secrets --output`。文件经 Halo 的所选 Policy 和 S3 插件上传，CLI 不直接持有 S3 SDK 或在上传时读取桶凭据。上传需要 `attachments:write`；配置策略还需要 `policies:read/write`、读取 Schema 的 `settings:read` 和相应 Halo 角色。

## 其他命令与开发

文章、页面、分类、标签、评论、附件、菜单、插件、主题、通用 Extension、搜索和邮件模板命令继续可用。运行 `halo-cli --help` 或 `halo-cli <group> --help` 查看完整参数。危险删除、还原、审核和重置要求明确确认。

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
node dist/halo-cli.cjs --help
```

完整插件在仓库根目录执行 `./gradlew build`，需要 Java 21 和项目指定的 Node.js/pnpm。详细命令参考见[项目 README](../README.md)。
