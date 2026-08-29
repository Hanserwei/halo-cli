# Halo CLI

[![CI](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml/badge.svg)](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml)
[![Halo](https://img.shields.io/badge/Halo-%3E%3D%202.26-4f46e5)](https://www.halo.run/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020.19-339933)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/hanserwei/halo-cli)](./LICENSE)

Halo CLI 是一个 Halo 插件和配套命令行工具，用于从终端管理 Halo 内容。插件在 Console 中提供 CLI 下载入口，CLI 通过 Halo 官方 REST API 和个人令牌访问一个或多个 Halo 站点。

当前版本为 `0.1.0`，已实现文章、分类和标签管理，兼容 Halo `2.26+`。

> [!NOTE]
> 本项目是社区插件，与 Halo 官方发布的 [`@halo-dev/cli`](https://github.com/halo-dev/cli) 相互独立。

## 亮点

- 单文件 CLI：插件内嵌 `halo-cli.cjs`，下载后无需安装额外 npm 依赖
- 多环境管理：可保存多套站点配置，也可完全通过环境变量运行
- 文章工作流：支持草稿、发布、取消发布、回收、恢复和永久删除
- 内容属性：支持多分类、多标签、公开/内部/私密可见性、置顶和评论开关
- 多级分类：通过父分类 `metadata.name` 创建任意层级结构
- 自动化友好：所有查询及写操作均可输出 JSON
- 安全保护：危险操作必须显式使用 `--yes`，删除会等待 Halo 完成异步清理

## 工作方式

```text
Halo Console
    │
    ├── 安装插件 ──> 受 RBAC 保护的 CLI 下载接口 ──> halo-cli.cjs
    │
    └── 创建个人令牌
                       │
Terminal ── halo-cli ──┴── Bearer PAT ──> Halo Core / Console REST API
```

插件只负责分发 CLI，不代理文章、分类或标签请求。CLI 直接连接目标 Halo，因此同一个 CLI 可以管理多个站点。

## 功能状态

| 资源 | 第一阶段能力 | 状态 |
| --- | --- | --- |
| 认证 | 登录验证、多 Profile、环境变量、切换和退出 | 已完成 |
| 文章 | 列表、详情、创建、更新、发布、取消发布、回收、恢复、永久删除 | 已完成 |
| 分类 | 列表、详情、多级创建、更新、删除 | 已完成 |
| 标签 | 列表、详情、创建、更新、删除 | 已完成 |
| 页面 | 页面内容与发布状态管理 | 第二阶段 |
| 评论 | 评论、回复与审核管理 | 第二阶段 |
| 附件 | 上传、查询和删除 | 第二阶段 |

## 安装

### 1. 构建并安装插件

本项目当前通过插件提供 CLI，尚未发布 npm 包。克隆仓库并构建：

```bash
git clone https://github.com/hanserwei/halo-cli.git
cd halo-cli
./gradlew clean build
```

构建产物位于 `build/libs/`。在 Halo Console 的「插件」页面上传并启用 JAR，然后打开「工具 / Halo CLI」。

超级管理员默认可以下载 CLI。普通用户需要被授予插件提供的「Halo CLI / 下载 Halo CLI」角色。

### 2. 下载并安装 CLI

推荐直接在「工具 / Halo CLI」页面点击下载，然后运行：

```bash
mkdir -p ~/.local/bin
install -m 0755 ~/Downloads/halo-cli.cjs ~/.local/bin/halo-cli
halo-cli --version
```

请确保 `~/.local/bin` 已加入 `PATH`。

也可以使用具有下载权限的个人令牌从终端下载：

```bash
export HALO_TOKEN=pat_xxx
mkdir -p ~/.local/bin
curl -fL \
  -H "Authorization: Bearer ${HALO_TOKEN}" \
  https://your-halo.example/apis/console.api.halo-cli.halo.run/v1alpha1/downloads/cli \
  -o ~/.local/bin/halo-cli
chmod +x ~/.local/bin/halo-cli
unset HALO_TOKEN
```

### 3. 连接 Halo

在 Halo 个人中心创建个人令牌。为了避免令牌进入 Shell 历史，可以先静默读取：

```bash
read -rsp "Halo PAT: " HALO_PAT_INPUT
halo-cli auth login \
  --profile production \
  --url https://your-halo.example \
  --token "${HALO_PAT_INPUT}"
unset HALO_PAT_INPUT
```

`auth login` 会在保存前请求 Halo 当前用户接口验证地址和令牌。

## 快速开始

```bash
# 查看当前连接
halo-cli auth current

# 查询内容
halo-cli post list
halo-cli category list
halo-cli tag list

# 查看完整帮助
halo-cli --help
halo-cli post create --help
```

资源的 `<name>` 均表示 Halo `metadata.name`，不是文章标题、分类显示名称或标签显示名称。可以通过对应的 `list` 命令获取。

## 命令参考

### 认证

| 命令 | 说明 |
| --- | --- |
| `halo-cli auth login` | 验证并保存站点地址和个人令牌 |
| `halo-cli auth list` | 列出 Profile，不显示令牌 |
| `halo-cli auth current` | 查看当前 Profile |
| `halo-cli auth use <name>` | 切换当前 Profile |
| `halo-cli auth logout [name]` | 删除 Profile 及其本地令牌 |

所有资源命令都支持 `--profile <name>`。也可以为单次请求同时传入 `--url` 和 `--token`。

### 文章

| 命令 | 说明 |
| --- | --- |
| `halo-cli post list` | 分页查询文章，支持关键词和发布阶段筛选 |
| `halo-cli post get <name>` | 查看文章模型及草稿正文 |
| `halo-cli post create` | 创建 Markdown/HTML 文章，可立即发布 |
| `halo-cli post update <name>` | 更新元数据、分类、标签或正文 |
| `halo-cli post publish <name>` | 发布当前草稿 |
| `halo-cli post unpublish <name>` | 取消发布并回到草稿状态 |
| `halo-cli post recycle <name> --yes` | 移入回收站 |
| `halo-cli post restore <name> --yes` | 从回收站恢复 |
| `halo-cli post delete <name> --yes` | 永久删除并等待资源返回 404 |

从 Markdown 文件创建公开文章：

```bash
halo-cli post create \
  --title "Hello Halo" \
  --slug hello-halo \
  --file ./hello.md \
  --categories category-example \
  --tags tag-halo,tag-cli \
  --visible PUBLIC \
  --publish
```

创建草稿时省略 `--publish`。可见性支持 `PUBLIC`、`INTERNAL` 和 `PRIVATE`：

```bash
halo-cli post create \
  --title "内部手册" \
  --content "# 内部手册" \
  --visible INTERNAL \
  --allow-comment false \
  --publish
```

更新时可以显式设置布尔值，也可以传入空列表清除分类或标签：

```bash
halo-cli post update <post-name> \
  --pinned true \
  --allow-comment false \
  --categories "" \
  --tags ""
```

### 多级分类

先创建父分类，再使用其 `metadata.name` 创建子分类：

```bash
root_name=$(halo-cli category create \
  --display-name "开发技术" \
  --slug development \
  --json | jq -r '.metadata.name')

child_name=$(halo-cli category create \
  --display-name "服务端开发" \
  --slug backend \
  --parent "${root_name}" \
  --json | jq -r '.metadata.name')

halo-cli category create \
  --display-name "Java 生态" \
  --slug java \
  --parent "${child_name}"
```

分类支持描述、封面和排序优先级：

```bash
halo-cli category update <category-name> \
  --description "Java、JVM 与 Spring 生态" \
  --priority 100
```

### 标签

```bash
halo-cli tag create \
  --display-name "Halo 2" \
  --slug halo-2 \
  --description "Halo 2 相关内容" \
  --color "#4f46e5"

halo-cli tag update <tag-name> --color "#2563eb"
halo-cli tag delete <tag-name> --yes
```

标签颜色必须使用 `#fff` 或 `#ffffff` 格式。

## JSON 与自动化

所有查询和写操作都支持 `--json`，错误信息写入 stderr，失败时退出码非零：

```bash
halo-cli post list --json | jq '.items[].post.spec.title'
halo-cli category list --json | jq '.items[] | {name: .metadata.name, title: .spec.displayName}'
```

CI 中可以完全绕过本地配置文件：

```bash
HALO_BASE_URL=https://your-halo.example \
HALO_TOKEN=pat_xxx \
halo-cli post list --json
```

支持的环境变量：

| 环境变量 | 用途 |
| --- | --- |
| `HALO_BASE_URL` | 临时 Halo 地址，需和 `HALO_TOKEN` 一起使用 |
| `HALO_TOKEN` | 临时个人令牌 |
| `HALO_PROFILE` | 选择已保存的 Profile |
| `HALO_CLI_CONFIG_DIR` | 覆盖配置目录，常用于测试或 CI |
| `XDG_CONFIG_HOME` | 控制默认 XDG 配置目录 |

## 配置与安全

默认配置路径按以下顺序解析：

1. `$HALO_CLI_CONFIG_DIR/config.json`
2. `$XDG_CONFIG_HOME/halo-cli/config.json`
3. `~/.config/halo-cli/config.json`

配置目录权限为 `0700`，配置文件权限为 `0600`。当前版本将令牌保存在配置文件中，因此请注意：

- 不要把配置文件加入版本控制或发送给其他人
- 公共/共享机器优先使用 `HALO_TOKEN` 环境变量
- 只授予 PAT 完成目标操作所需的最小权限
- PAT 一旦出现在聊天、日志或 Shell 历史中，应立即撤销并重新生成

CLI 不会在 `auth list`、`auth current` 或正常错误输出中显示令牌。

## 本地开发

### 环境要求

- Java 21+
- Node.js 20.19+ 或 22.12+
- pnpm 10+

启动 Halo 插件开发环境：

```bash
./gradlew haloServer
```

开发 Console UI：

```bash
cd ui
pnpm install
pnpm dev
```

开发 CLI：

```bash
cd cli
pnpm install
pnpm dev -- --help
pnpm check
pnpm build
```

完整验收：

```bash
./gradlew clean build
```

该命令会执行 Java 测试、CLI 类型检查与单元测试、Console UI 类型检查和生产构建，并验证 CLI 已被嵌入插件 JAR。

## 项目结构

```text
cli/                  独立 CLI 源码、测试和单文件构建
ui/                   Halo Console 下载与使用页面
src/main/java/        插件生命周期和 CLI 下载 API
src/main/resources/   插件清单与 RBAC 角色模板
.github/workflows/    插件 CI/CD 工作流
```

## 路线图

- `0.1.x`：完善文章、分类、标签体验和发布流程
- `0.2.x`：页面、评论和附件管理
- 后续：批量操作、导入导出、Shell 补全和更多内容类型

欢迎通过 [Issues](https://github.com/hanserwei/halo-cli/issues) 提交问题或建议。

## 许可证

[GPL-3.0](./LICENSE) © hanserwei
