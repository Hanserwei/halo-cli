# Halo CLI

[![CI](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml/badge.svg)](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml)
[![Halo](https://img.shields.io/badge/Halo-%3E%3D%202.26-4f46e5)](https://www.halo.run/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020.19-339933)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/hanserwei/halo-cli)](./LICENSE)

Halo CLI 是一个 Halo 插件和配套命令行工具，用于从终端管理 Halo 内容。插件在 Console 中提供 CLI 下载入口，CLI 通过 Halo 官方 REST API 和个人令牌访问一个或多个 Halo 站点。

当前版本为 `0.3.0`，已实现文章、页面、分类、标签、评论、附件和菜单管理，兼容 Halo `2.26+`。

> [!NOTE]
> 本项目是社区插件，与 Halo 官方发布的 [`@halo-dev/cli`](https://github.com/halo-dev/cli) 相互独立。

## 亮点

- 单文件 CLI：插件内嵌 `halo-cli.cjs`，下载后无需安装额外 npm 依赖
- 多环境管理：可保存多套站点配置，也可完全通过环境变量运行
- 文章工作流：支持草稿、发布、取消发布、回收、恢复和永久删除
- 页面工作流：支持独立页面生命周期以及内容快照查询、恢复和删除
- 评论审核：支持评论与回复查询、批准、取消批准、回复和异步删除
- 附件管理：支持本地上传、URL 转存、查询、更新、下载和异步删除
- 菜单管理：支持主菜单、菜单复制、内容引用、任意层级和拖拽等价排序
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

插件只负责分发 CLI，不代理内容管理请求。CLI 直接连接目标 Halo，因此同一个 CLI 可以管理多个站点。

## 功能状态

| 资源 | 能力 | 状态 |
| --- | --- | --- |
| 认证 | 登录验证、多 Profile、环境变量、切换和退出 | 已完成 |
| 文章 | 列表、详情、创建、更新、发布、取消发布、回收、恢复、永久删除 | 已完成 |
| 分类 | 列表、详情、多级创建、更新、删除 | 已完成 |
| 标签 | 列表、详情、创建、更新、删除 | 已完成 |
| 页面 | 内容、发布状态、回收站和内容快照管理 | 已完成 |
| 评论 | 评论与回复查询、审核、回复和删除 | 已完成 |
| 附件 | 查询、本地上传、URL 转存、更新、下载和删除 | 已完成 |
| 菜单 | 菜单组、主菜单、复制、菜单项树、内容引用、移动和删除 | 已完成 |

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
halo-cli page list
halo-cli comment list
halo-cli attachment list
halo-cli menu list
halo-cli category list
halo-cli tag list

# 查看完整帮助
halo-cli --help
halo-cli post create --help
```

资源的 `<name>` 均表示 Halo `metadata.name`，不是标题或显示名称。可以通过对应的 `list` 命令获取。

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

### 页面与内容快照

页面命令与文章命令使用相同的 Markdown、可见性和发布状态约定：

```bash
halo-cli page create \
  --title "关于本站" \
  --slug about \
  --file ./about.md \
  --visible PUBLIC \
  --publish

halo-cli page update <page-name> --file ./about-new.md
halo-cli page unpublish <page-name>
halo-cli page recycle <page-name> --yes
halo-cli page restore <page-name> --yes
```

页面正文由 Halo 内容快照保存，可以独立查询：

```bash
halo-cli page snapshot-list <page-name>
halo-cli page snapshot-get <page-name> <snapshot-name>
halo-cli page snapshot-revert <page-name> <snapshot-name> --yes
halo-cli page snapshot-delete <page-name> <snapshot-name> --yes
```

> [!WARNING]
> Halo 2.26 在恢复到不同于当前 `headSnapshot` 的历史快照时，会创建新的正文快照并立即发布页面，因此 `snapshot-revert` 明确要求 `--yes`。如果目标已经是当前草稿头，CLI 会拒绝无效恢复；需要发布时请改用 `page publish`。

### 评论与回复

Halo 2.26 的 Console 评论审核模型是“批准/取消批准”，没有独立的垃圾评论或回收站状态：

```bash
halo-cli comment list --approved false
halo-cli comment get <comment-name>
halo-cli comment approve <comment-name>
halo-cli comment unapprove <comment-name>

halo-cli comment replies <comment-name>
halo-cli comment reply <comment-name> --content "感谢反馈"
halo-cli comment reply <comment-name> \
  --content "补充说明" \
  --quote <reply-name>
halo-cli comment reply-unapprove <reply-name>
```

按文章或页面筛选评论时，主题引用使用 `group/kind/name`：

```bash
halo-cli comment list \
  --subject content.halo.run/Post/<post-name>
```

删除评论会由 Halo 异步级联删除其回复；评论和回复删除命令均要求 `--yes`，并等待资源真正消失后才报告成功。

### 附件

上传前先查询 Halo 中可用的存储策略与附件分组：

```bash
halo-cli attachment policies
halo-cli attachment groups

halo-cli attachment upload \
  --file ./cover.png \
  --policy <policy-name> \
  --group <group-name>

halo-cli attachment upload-url https://example.com/image.png \
  --policy <policy-name> \
  --filename image.png
```

附件“重命名”只修改 `spec.displayName`，不会改变 `metadata.name` 或永久链接：

```bash
halo-cli attachment update <attachment-name> --display-name cover.png
halo-cli attachment update <attachment-name> --group <group-name>
halo-cli attachment update <attachment-name> --group ""
halo-cli attachment download <attachment-name> --output ./cover.png
halo-cli attachment delete <attachment-name> --yes
```

下载默认拒绝覆盖已有文件，必须显式使用 `--force` 才会覆盖。CLI 会逐次检查重定向目标，只有与 Halo 同源的请求才携带 PAT；外部对象存储请求不会携带 Halo 凭据。

### 菜单与导航

菜单命令对应 Halo Console 的「外观 / 菜单」页面。先查看菜单和当前主菜单：

PAT 对应用户至少需要 Halo 的「Menu View」角色；创建、更新、移动、复制、设置主菜单和删除需要「Menu Manage」角色。

```bash
halo-cli menu list
halo-cli menu primary
halo-cli menu tree primary
```

创建菜单并设置为主菜单：

```bash
menu_name=$(halo-cli menu create \
  --display-name "站点导航" \
  --json | jq -r '.metadata.name')

halo-cli menu set-primary "${menu_name}"
```

菜单项支持自定义链接，也可以引用文章、页面、分类或标签。引用型菜单项的显示名称和链接由 Halo 根据目标资源自动解析：

```bash
# 自定义根菜单项
home_item=$(halo-cli menu item-create \
  --menu "${menu_name}" \
  --display-name "首页" \
  --href / \
  --target _self \
  --json | jq -r '.metadata.name')

# 引用页面
halo-cli menu item-create \
  --menu "${menu_name}" \
  --ref-kind page \
  --ref-name <single-page-name>

# 在“首页”下面引用分类
halo-cli menu item-create \
  --menu "${menu_name}" \
  --parent "${home_item}" \
  --ref-kind category \
  --ref-name <category-name>
```

移动命令与 Console 拖拽使用相同的 Halo 2.26 position API。`--parent ""` 表示根级，`--before` 表示放到指定同级项之前；省略 `--before` 表示追加到末尾：

```bash
halo-cli menu item-move <menu-item-name> \
  --menu "${menu_name}" \
  --parent "" \
  --before <root-sibling-name>
```

其他管理操作：

```bash
halo-cli menu item-get <menu-item-name>
halo-cli menu item-update <menu-item-name> --target _blank
halo-cli menu clone "${menu_name}" --display-name "站点导航副本"
halo-cli menu item-delete <menu-item-name> --yes
halo-cli menu delete <menu-name> --yes
```

`item-delete` 会删除目标菜单项及其全部后代。`menu delete` 会使用 Console 级联删除端点并等待菜单和所有菜单项真正返回 404；当前主菜单不能删除，必须先用 `set-primary` 切换到其他菜单。

> [!NOTE]
> Halo 2.26 已弃用 `Menu.spec.menuItems` 和 `MenuItem.spec.children` 作为层级来源。CLI 只通过 `MenuItem.spec.menuName`、`parent`、`priority` 和 Console position API 管理树结构。

## JSON 与自动化

所有查询和写操作都支持 `--json`，错误信息写入 stderr，失败时退出码非零：

```bash
halo-cli post list --json | jq '.items[].post.spec.title'
halo-cli page list --json | jq '.items[].page.spec.title'
halo-cli attachment list --json | jq '.items[].status.permalink'
halo-cli menu tree primary --json | jq '.. | objects | .menuItem?.metadata.name // empty'
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
- 配置的 Halo 地址发生 HTTP 重定向时，CLI 会拒绝自动跟随，避免令牌或上传正文跨源重放

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

该命令会执行 Java 测试、CLI 类型检查与测试、Console UI 类型检查和生产构建，并验证 CLI 已被嵌入插件 JAR。CLI 测试还包含本地 HTTP 重定向场景，验证 PAT 不会被发送到外部附件源。

## 项目结构

```text
cli/                  独立 CLI 源码、测试和单文件构建
ui/                   Halo Console 下载与使用页面
src/main/java/        插件生命周期和 CLI 下载 API
src/main/resources/   插件清单与 RBAC 角色模板
.github/workflows/    插件 CI/CD 工作流
```

## 路线图

- `0.1.x`：文章、分类和标签管理
- `0.2.x`：页面、评论和附件管理
- `0.3.x`：菜单组、主菜单和树形菜单项管理
- 后续：批量操作、导入导出、Shell 补全、附件分组/策略管理和更多内容类型

欢迎通过 [Issues](https://github.com/hanserwei/halo-cli/issues) 提交问题或建议。

## 许可证

[GPL-3.0](./LICENSE) © hanserwei
