# @hanserwei/halo-cli

Halo `2.26+` 的命令行内容管理工具，当前版本为 `0.4.0`。运行时需要 Node.js `20.19+`。

## 开发

```bash
pnpm install
pnpm check
pnpm build
node dist/halo-cli.cjs --help
```

`pnpm build` 生成不依赖本地 `node_modules` 的 `dist/halo-cli.cjs` 单文件。插件构建会将它嵌入 JAR，并通过下载 API 提供给 Console 用户。

## 认证

推荐使用 Halo 个人令牌：

```bash
halo-cli auth login --url http://127.0.0.1:8090 --token pat_xxx
```

也可使用 `HALO_BASE_URL`、`HALO_TOKEN` 和可选的 `HALO_PROFILE` 环境变量。

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
```

页面命令覆盖发布、回收站和内容快照；评论命令覆盖审核与回复；附件命令覆盖策略/分组查询、本地上传、URL 转存、更新、流式下载和删除；菜单命令覆盖主菜单、复制、内容引用、树形移动和级联删除；插件和主题命令覆盖发现、详情、Setting Schema、当前配置读取和 JSON 导出。配置读取默认脱敏，原始敏感配置只能导出到文件；所有查询及写操作都支持 `--json`，不可逆操作必须显式传入 `--yes`。
