# Halo CLI

[![CI](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml/badge.svg)](https://github.com/hanserwei/halo-cli/actions/workflows/ci.yaml)
[![Halo](https://img.shields.io/badge/Halo-%3E%3D%202.26-4f46e5)](https://www.halo.run/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020.19-339933)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/hanserwei/halo-cli)](./LICENSE)

Halo CLI 是一个 Halo 插件和配套命令行工具，用于从终端管理 Halo 内容。插件在 Console 中提供 CLI 下载入口，CLI 通过 Halo 官方 REST API 和个人令牌访问一个或多个 Halo 站点。

当前版本为 `0.5.0`，已实现 Halo 核心内容管理、插件/主题生命周期与配置写入、通用 Extension CRUD，以及 Hao 1.7.3 和常用插件适配，兼容 Halo `2.26+`。

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
- 插件和主题配置：生命周期、配置 Schema、定点修改、合并导入、重置和安全导出
- Hao 与插件内容：依赖体检、页面模板、注解字段，以及友链、瞬间、图库、追番和装备模型
- 扩展 API：任意 Extension CRUD、搜索索引、同站 JSON API 和 multipart 上传
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
| 插件和主题 | 发现、启停/激活、重载、Setting Schema、配置读取、定点修改、合并导入和重置 | 已完成 |
| Extension | 已知别名及任意 `group/version/resource` 的列表、详情、创建、合并更新、JSON Pointer、JSON Patch 和删除 | 已完成 |
| Hao 1.7.3 | 依赖体检、7 个页面模板、5 类注解字段及常用插件模型映射 | 已完成 |
| 搜索和插件 API | Halo 搜索索引、同站 JSON API、multipart 文件上传和敏感响应脱敏 | 已完成 |

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
halo-cli plugin list
halo-cli theme current
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

### 插件与主题生命周期和配置

0.5.0 在原有发现、Schema、配置读取与导出的基础上，增加了生命周期和配置写入：

```bash
halo-cli plugin list
halo-cli plugin get <plugin-name>
halo-cli plugin setting <plugin-name>
halo-cli plugin config <plugin-name>
halo-cli plugin config-export <plugin-name> --output ./plugin-config.json
halo-cli plugin enable <plugin-name>
halo-cli plugin disable <plugin-name>
halo-cli plugin reload <plugin-name>

halo-cli theme list
halo-cli theme current
halo-cli theme get <theme-name>
halo-cli theme setting <theme-name>
halo-cli theme config <theme-name>
halo-cli theme config-export <theme-name> --output ./theme-config.json
halo-cli theme activate <theme-name>
halo-cli theme reload <theme-name>
halo-cli theme invalidate-cache <theme-name>
halo-cli theme templates <theme-name>
```

`plugin list` 和 `theme list` 显示 `metadata.name`、显示名称、版本、启用/激活状态，以及是否声明 Setting 和 ConfigMap。`setting` 输出 Halo Console 用于渲染 FormKit 表单的完整 Setting Schema；`config` 输出当前按配置分组的 JSON 数据。

配置中的字段名包含 `password`、`token`、`secret`、`apiKey`、`credential`、`authorization` 或 `key` 时，终端输出和普通导出会递归替换为 `[REDACTED]`。如果确实需要导出原始敏感字段，只能显式使用：

```bash
halo-cli plugin config-export <plugin-name> \
  --output ./plugin-config-with-secrets.json \
  --include-secrets
```

敏感配置禁止直接打印到终端；导出文件默认使用 `0600` 权限，已存在的目标文件默认拒绝覆盖，替换时必须使用 `--force`。`config-export` 需要显式指定 `--output`。

使用 RFC 6901 JSON Pointer 只修改一个字段。值会优先按 JSON 解析，因此 `true`、`42`、`null`、对象和数组会保留类型；普通文本按字符串处理：

```bash
# Hao：开启首页第一屏
halo-cli theme config-set theme-hao \
  /top/above/enable_above true

# 瞬间插件：示例路径以当前插件 Setting Schema 为准
halo-cli plugin setting PluginMoments --json
halo-cli plugin config-set PluginMoments \
  /basic/enable_comment true
```

配置文件默认递归合并，未出现在文件中的字段保持不变。完整替换必须同时提供 `--replace --yes`：

```bash
halo-cli theme config-import theme-hao --file ./hao-partial.json
halo-cli plugin config-import PluginLinks --file ./links-partial.json

halo-cli theme config-import theme-hao \
  --file ./hao-complete.json \
  --replace --yes
```

CLI 拒绝导入包含字面量 `[REDACTED]` 的文件，避免把普通脱敏导出误写回服务器。恢复 Schema 默认配置同样要求明确确认：

```bash
halo-cli plugin config-reset PluginMoments --yes
halo-cli theme config-reset theme-hao --yes
```

### Hao 1.7.3 适配

`hao doctor` 会交叉检查当前主题、Hao 版本、常用插件的安装和启用状态，并返回页面模板与注解目录：

```bash
halo-cli hao doctor
halo-cli hao doctor --json
halo-cli hao templates
halo-cli hao annotations
```

当前适配清单包括：

| Hao 功能 | 插件 `metadata.name` | CLI 入口 |
| --- | --- | --- |
| 默认评论 | `PluginCommentWidget` | `comment`、`plugin config-*` |
| 搜索组件 | `PluginSearchWidget` | `search query` |
| 友情链接 | `PluginLinks` | `extension link-group/link`、`api request` |
| 瞬间 | `PluginMoments` | `extension moment` |
| Bilibili 追番 | `plugin-bilibili-bangumi` | `plugin config-*`、`extension bangumi` |
| 图库 | `PluginPhotos` | `extension photo-group/photo`、`api upload` |
| KaTeX | `plugin-katex` | `post`、`page`、`plugin config-*` |
| 装备 | `equipment` | `extension equipment-group/equipment` |
| Markdown / HTML 内容块 | `hybrid-edit-block` | `post`、`page`（插件本身无业务模型） |
| 爱发电 | `plugin-afdian` | `plugin config-*`、`api request` |

Hao 源码额外探测 `PluginFeed`（RSS）、`PluginPrismJS`、`plugin-platforms-sync` 和 `link-submit`。这些是可选兼容项，不安装不会让 `hao doctor` 失败；安装后仍可通过通用 `plugin config-*`、`extension group/version/resource` 和 `api request` 管理。Twikoo、Artalk、Waline 是外部评论后端，其连接信息通过 `theme config-set theme-hao ...` 管理。

Hao 注册的 7 个页面模板可直接传给现有页面命令：

```bash
halo-cli page create \
  --title "关于" \
  --slug about \
  --template about.html \
  --content "# 关于" \
  --publish
```

可用模板文件为 `page_links.html`、`about.html`、`music.html`、`comments.html`、`todolist.html`、`album.html` 和 `new_comment.html`。

文章和菜单项支持直接合并 Hao 注解：

```bash
halo-cli post update <post-name> \
  --annotations '{"ai":"true","copyrightEnable":"true","copyrightType":"original"}'

halo-cli menu item-update <menu-item-name> \
  --annotations '{"icon":"haofont hao-icon-home","isVertical":"0"}'
```

### 插件 Extension 资源

`extension` 对 Halo 的 Extension API 提供统一 CRUD。内置别名覆盖 Hao 常用业务模型：

```bash
halo-cli extension presets
halo-cli extension list link-group
halo-cli extension list link
halo-cli extension list moment
halo-cli extension list photo-group
halo-cli extension list photo
halo-cli extension list bangumi
halo-cli extension list equipment-group
halo-cli extension list equipment
```

创建带 Hao 美化字段的友链分组和链接：

```bash
group_name=$(halo-cli extension create link-group \
  --spec '{"displayName":"技术伙伴","priority":10}' \
  --annotations '{"displayStyle":"beautify","description":"长期关注的技术站点"}' \
  --json | jq -r '.metadata.name')

halo-cli extension create link \
  --spec "$(jq -nc --arg group "$group_name" '{
    displayName: "Halo",
    url: "https://www.halo.run",
    logo: "https://www.halo.run/logo",
    groupName: $group,
    priority: 10
  }')" \
  --annotations '{"label":"推荐","labelColor":"#425AEF"}'
```

创建瞬间、图库分组和装备分组：

```bash
halo-cli extension create moment --spec '{
  "content":{"raw":"今天开始使用 Halo CLI","html":"<p>今天开始使用 Halo CLI</p>","medium":[]},
  "owner":"<user-metadata-name>",
  "visible":"PUBLIC",
  "tags":["Halo"],
  "approved":true
}'

halo-cli extension create photo-group \
  --spec '{"displayName":"旅行","priority":10}' \
  --annotations '{"cover":"/upload/cover.webp","background":"/upload/banner.webp","description":"旅途记录"}'

halo-cli extension create equipment-group \
  --spec '{"displayName":"开发设备","description":"日常生产力工具","priority":10}'
```

局部更新支持合并 spec/annotations、JSON Pointer 和 JSON Patch：

```bash
halo-cli extension update link <link-name> \
  --spec '{"description":"Halo 官方网站"}' \
  --annotations '{"label":"官方"}'

halo-cli extension set link <link-name> \
  /metadata/annotations/labelColor '"#2563EB"'

halo-cli extension patch moment <moment-name> \
  --patch '[{"op":"add","path":"/spec/tags","value":["Halo","CLI"]}]'

halo-cli extension delete photo <photo-name> --yes
```

不在预设中的插件模型可以直接使用 `group/version/resource`。创建时额外提供 `--kind`：

```bash
halo-cli extension list example.plugin.halo.run/v1alpha1/widgets --json
halo-cli extension create example.plugin.halo.run/v1alpha1/widgets \
  --kind Widget \
  --spec '{"displayName":"Example"}'
```

### 搜索与插件自定义 API

搜索命令直接调用 Halo 搜索索引，搜索组件无需额外抓取页面：

```bash
halo-cli search query "Halo CLI"
halo-cli search query "图库" \
  --types post,singlePage \
  --limit 10 \
  --json
```

插件没有统一业务模型的特殊能力可通过 `api` 调用。路径只能指向当前 Profile 的 `/apis/` 或 `/api/`，CLI 不接受外部 URL，也不会跟随重定向：

```bash
# 爱发电赞助列表
halo-cli api request GET \
  /apis/api.plugin.halo.run/v1alpha1/plugins/plugin-afdian/afdian/getSponsorList

# 刷新指定友链的 RSS
halo-cli api request POST \
  /apis/console.api.link.halo.run/v1alpha1/links/<link-name>/rss/refresh

# 图库插件直接上传图片
halo-cli api upload \
  /apis/console.api.photo.halo.run/v1alpha1/photos/upload \
  --file ./photo.jpg \
  --form '{"group":"<photo-group-name>"}'
```

`api request` 支持 GET、POST、PUT、PATCH 和 DELETE，使用 `--query <json>`、`--body <json>` 或 `--file <json-file>` 传参。DELETE 必须提供 `--yes`。API 响应默认递归脱敏；原始敏感响应仍只能配合 `--include-secrets --output <file>` 导出。

## JSON 与自动化

所有查询和写操作都支持 `--json`，错误信息写入 stderr，失败时退出码非零：

```bash
halo-cli post list --json | jq '.items[].post.spec.title'
halo-cli page list --json | jq '.items[].page.spec.title'
halo-cli attachment list --json | jq '.items[].status.permalink'
halo-cli plugin config <plugin-name> --json | jq 'keys'
halo-cli theme config <theme-name> --json | jq 'keys'
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
- `0.4.x`：插件和主题发现、Setting Schema、当前配置读取和 JSON 导出（只读）
- `0.5.x`：Hao 1.7.3 与常用插件适配、Extension CRUD、配置写入、搜索和同站插件 API
- 后续：批量操作、Shell 补全、应用安装/升级和更多领域化快捷命令

欢迎通过 [Issues](https://github.com/hanserwei/halo-cli/issues) 提交问题或建议。

## 许可证

[GPL-3.0](./LICENSE) © hanserwei
