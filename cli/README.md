# @hanserwei/halo-cli

Halo `2.26+` 的命令行内容管理工具，当前版本为 `0.5.0`。运行时需要 Node.js `20.19+`。

## 开发

```bash
pnpm install
pnpm check
pnpm build
node dist/halo-cli.cjs --help
```

`pnpm build` 生成不依赖本地 `node_modules` 的 `dist/halo-cli.cjs` 单文件。插件构建会将它嵌入 JAR，并通过下载 API 提供给 Console 用户。

## 认证

在 Halo Console 的「工具 / Halo CLI」创建专用访问密钥，通过标准输入连接：

```bash
read -rsp "Halo CLI key: " HALO_KEY_INPUT
printf '\n'
printf '%s' "${HALO_KEY_INPUT}" | halo-cli auth login \
  --url http://127.0.0.1:8090 --token-stdin
unset HALO_KEY_INPUT
```

专用密钥受操作范围、有效期、IP 白名单和所属用户当前的 Halo 权限约束。旧 PAT 和已保存的 Profile 继续可用。自动化可使用成组的 `HALO_BASE_URL`、`HALO_TOKEN` 环境变量，也可通过 `--profile` / `HALO_PROFILE` 选择保存的连接。`auth logout` 仅删除本地连接；服务端密钥可在 Console 中停用、轮换或删除。

运行 `halo-cli --help` 查看全部命令组：

```bash
halo-cli post --help
halo-cli page --help
halo-cli category --help
halo-cli tag --help
halo-cli comment --help
halo-cli attachment --help
halo-cli menu --help
halo-cli plugin --help
halo-cli theme --help
halo-cli extension --help
halo-cli search --help
halo-cli api --help
halo-cli hao --help
halo-cli mail-template --help
```

Hao 1.7.3 与常用插件适配状态：

```bash
halo-cli hao doctor
halo-cli extension presets
```

页面命令覆盖发布、回收站和内容快照；评论命令覆盖审核与回复；附件命令覆盖策略/分组查询、本地上传、URL 转存、更新、流式下载和删除；菜单命令覆盖主菜单、复制、内容引用、树形移动和级联删除；插件和主题命令覆盖发现、详情、Setting Schema、当前配置读取和 JSON 导出。配置读取默认脱敏，原始敏感配置只能导出到文件；所有查询及写操作都支持 `--json`，不可逆操作必须显式传入 `--yes`。

安装独立维护的邮件模板插件后可使用：

```bash
halo-cli mail-template list
halo-cli mail-template get <reason-type-name> --json
halo-cli mail-template export <reason-type-name> --output template.json
halo-cli mail-template update <reason-type-name> --html-file notification.html
halo-cli mail-template validate <reason-type-name> --html-file notification.html
halo-cli mail-template import <reason-type-name> --file template.json
halo-cli mail-template verify <reason-type-name> --yes
halo-cli mail-template restore <reason-type-name> --yes
```

更新只修改显式传入的字段，恢复只删除自定义模板。验证发送使用当前凭据所属用户的邮箱，需要额外发送权限。
