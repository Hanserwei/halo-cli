# @hanserwei/halo-cli

Halo `2.26+` 的命令行内容管理工具。运行时需要 Node.js `20.19+`。

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

运行 `halo-cli --help` 查看文章、分类和标签命令。
