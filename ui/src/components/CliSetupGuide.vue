<script setup lang="ts">
import { VAlert, VCard } from '@halo-dev/components'
import { cliDownloadPath } from '../api/access-keys'
import CommandBlock from './CommandBlock.vue'

const siteUrl = window.location.origin

const unixInstall = `mkdir -p ~/.local/bin
install -m 0755 ~/Downloads/halo-cli.cjs ~/.local/bin/halo-cli
export PATH="$HOME/.local/bin:$PATH"
halo-cli --version`

const windowsInstall = `$cliDir = Join-Path $HOME '.local\\bin'
New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
Copy-Item (Join-Path $HOME 'Downloads\\halo-cli.cjs') (Join-Path $cliDir 'halo-cli.cjs')
'@node "%~dp0halo-cli.cjs" %*' | Set-Content -Path (Join-Path $cliDir 'halo-cli.cmd') -Encoding ascii
$env:Path = "$cliDir;$env:Path"
halo-cli --version`

const bashLogin = `read -r -s -p "CLI 密钥: " HALO_CLI_TOKEN
printf '\\n'
printf '%s' "$HALO_CLI_TOKEN" | halo-cli auth login \\
  --profile default \\
  --url "${siteUrl}" \\
  --token-stdin
unset HALO_CLI_TOKEN`

const powershellLogin = `$secureToken = Read-Host 'CLI 密钥' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) | halo-cli auth login --profile default --url "${siteUrl}" --token-stdin
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  $secureToken.Dispose()
  Remove-Variable secureToken, tokenPointer
}`

const verifyCommands = `halo-cli auth current
halo-cli post list --json
halo-cli --help`
</script>

<template>
  <VCard title="安装与连接">
    <div class=":uno: space-y-6 text-sm">
      <VAlert title="运行环境" type="info" :closable="false">
        <template #description>
          本地需要 Node.js 20.19 或更高版本，站点需要 Halo 2.26 或更高版本并启用 Halo CLI 插件。
          可先运行 node --version 确认运行环境。
        </template>
      </VAlert>

      <section class=":uno: space-y-3" aria-labelledby="cli-setup-download">
        <h3 id="cli-setup-download" class=":uno: font-medium">1. 下载 CLI</h3>
        <p class=":uno: text-gray-600">
          下载当前插件提供的单文件 halo-cli.cjs，保留文件名。下载使用当前 Console 登录会话，
          需要 CLI 下载权限；没有下载入口时，请联系管理员授予权限。
        </p>
        <HasPermission :permissions="['plugin:halo-cli:download:view']">
          <a :href="cliDownloadPath" download="halo-cli.cjs" class=":uno: inline-block text-primary hover:underline">
            下载 halo-cli.cjs
          </a>
        </HasPermission>
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-setup-install">
        <h3 id="cli-setup-install" class=":uno: font-medium">2. 安装到本地命令目录</h3>
        <p class=":uno: text-gray-600">以下示例假设文件保存在 Downloads 目录，请按实际下载位置调整路径。</p>
        <CommandBlock label="macOS / Linux · Bash" :command="unixInstall" />
        <p class=":uno: text-gray-600">
          将 ~/.local/bin 加入 Shell 启动配置中的 PATH，使新终端也能使用 halo-cli。
          macOS 如使用 zsh，请在 ~/.zshrc 中配置 PATH；下方连接示例需在 Bash 中执行。
        </p>
        <CommandBlock label="Windows · PowerShell" :command="windowsInstall" />
        <p class=":uno: text-gray-600">
          Windows 示例创建 halo-cli.cmd 启动入口，并为当前终端更新 PATH。
          将用户目录下的 .local\bin 加入用户环境变量 Path，可在新终端中继续使用。
          也可直接运行 node 后接 halo-cli.cjs 的完整路径，并在其后追加命令参数。
        </p>
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-setup-key">
        <h3 id="cli-setup-key" class=":uno: font-medium">3. 创建 CLI 密钥</h3>
        <p class=":uno: text-gray-600">
          前往 <a href="#cli-access-keys" class=":uno: text-primary hover:underline">CLI 访问密钥</a>
          创建专用密钥，按需选择作用域、有效期和 IP 限制。首次连接建议仅授予所需资源的读取权限；
          下方文章查询需要文章读取权限。
        </p>
        <p class=":uno: text-gray-600">
          完整密钥仅在创建或轮换时显示一次，请及时保存到密码管理器。
          密钥丢失时可轮换，泄露时应立即禁用或删除；请勿将密钥粘贴到命令、脚本或版本库中。
        </p>
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-setup-login">
        <h3 id="cli-setup-login" class=":uno: font-medium">4. 连接当前站点</h3>
        <p class=":uno: text-gray-600">
          选择对应终端执行，在隐藏输入提示中粘贴密钥后回车。
          示例通过标准输入传递凭据，站点地址预填为 {{ siteUrl }}，连接保存为 default。
          如果 CLI 从其他网络连接，请先确认该地址可访问且符合密钥的 IP 限制。
        </p>
        <CommandBlock label="Bash · 隐藏输入密钥" :command="bashLogin" />
        <CommandBlock label="PowerShell · 隐藏输入密钥" :command="powershellLogin" />
        <p class=":uno: text-gray-600">
          --token-stdin 需要管道输入，不能与 --token 同时使用。
          登录会先验证凭据，再保存并启用连接；同名 Profile 会被覆盖。
          管理多个站点时，请为 --profile 指定不同名称。
        </p>
      </section>

      <section class=":uno: space-y-3" aria-labelledby="cli-setup-verify">
        <h3 id="cli-setup-verify" class=":uno: font-medium">5. 只读验证</h3>
        <CommandBlock label="查看本地连接、查询文章和帮助" :command="verifyCommands" />
        <p class=":uno: text-gray-600">
          auth current 仅查看本地保存的连接；post list 才会请求站点验证资源访问，以上命令不会修改站点内容。
          如果查询被拒绝，请检查密钥是否启用、过期、具有文章读取权限，以及 IP 限制和所属用户权限。
        </p>
      </section>

      <VAlert title="本地配置与密钥保护" type="warning" :closable="false">
        <template #description>
          登录凭据以明文保存在 ~/.config/halo-cli/config.json。
          设置 XDG_CONFIG_HOME 时使用其下的 halo-cli/config.json；HALO_CLI_CONFIG_DIR 可直接指定配置目录，优先级更高。
          CLI 在保存时将配置文件权限设为 0600，在 macOS / Linux 上表示仅文件所有者可读写，这不等于加密。
          Windows 请使用文件安全属性限制账户访问；不要分享或提交配置文件。
          auth logout 可删除对应 Profile 的本地凭据，服务端密钥需在访问密钥列表中另行禁用或删除。
        </template>
      </VAlert>
    </div>
  </VCard>
</template>
