<script setup lang="ts">
import { computed, ref } from 'vue'

const downloadPath = '/apis/console.api.halo-cli.halo.run/v1alpha1/downloads/cli'
const copied = ref(false)
const origin = window.location.origin
const installCommand = computed(
  () => 'mkdir -p ~/.local/bin && install -m 0755 ~/Downloads/halo-cli.cjs ~/.local/bin/halo-cli',
)

async function copyInstallCommand() {
  await navigator.clipboard.writeText(installCommand.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>
  <section class="cli-page">
    <header class="hero">
      <div>
        <span class="eyebrow">HALO CONTENT TOOLING</span>
        <h1>Halo CLI</h1>
        <p>在终端中管理 Halo 文章、页面、分类、标签、评论和附件。单文件分发，无需额外服务。</p>
      </div>
      <a class="primary-button" :href="downloadPath" download="halo-cli.cjs">下载 CLI</a>
    </header>

    <div class="notice">
      <strong>运行要求</strong>
      <span>Node.js 20.19 或更高版本。当前版本为 0.2.0。</span>
    </div>

    <article class="panel install-panel">
      <div class="panel-title">
        <div>
          <span class="step">01</span>
          <h2>安装</h2>
        </div>
        <button type="button" class="copy-button" @click="copyInstallCommand">
          {{ copied ? '已复制' : '复制命令' }}
        </button>
      </div>
      <pre><code>{{ installCommand }}</code></pre>
      <p class="hint">先点击右上角下载，再执行安装命令；请确认 <code>~/.local/bin</code> 已加入 PATH。</p>
    </article>

    <div class="grid">
      <article class="panel">
        <div class="panel-title">
          <div>
            <span class="step">02</span>
            <h2>连接 Halo</h2>
          </div>
        </div>
        <p>在个人中心创建个人令牌，然后保存为本地连接：</p>
        <pre><code>halo-cli auth login \
  --url {{ origin }} \
  --token pat_xxx</code></pre>
        <p class="hint">令牌保存在权限为 0600 的用户配置文件中，不会显示在列表输出里。</p>
      </article>

      <article class="panel">
        <div class="panel-title">
          <div>
            <span class="step">03</span>
            <h2>开始管理</h2>
          </div>
        </div>
        <pre><code>halo-cli post list
halo-cli post create --title "Hello" --file post.md --publish
halo-cli page list
halo-cli comment list --approved false
halo-cli attachment policies
halo-cli category list
halo-cli tag create --display-name "Halo"</code></pre>
        <p class="hint">所有查询命令均支持 <code>--json</code>，可直接用于脚本和 CI。</p>
      </article>
    </div>

    <article class="panel scope-panel">
      <div>
        <span class="step">ROADMAP</span>
        <h2>功能范围</h2>
      </div>
      <div class="scope-list">
        <div class="scope-item ready">
          <span>0.1 · 已完成</span>
          <strong>文章 / 分类 / 标签</strong>
          <small>查询、创建、更新、发布、回收与删除</small>
        </div>
        <div class="scope-item ready">
          <span>0.2 · 已完成</span>
          <strong>页面 / 评论 / 附件</strong>
          <small>页面快照、评论审核回复、附件上传下载</small>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.cli-page {
  min-height: 100%;
  padding: 2rem;
  color: #172033;
  background:
    radial-gradient(circle at 82% 3%, rgb(68 111 255 / 14%), transparent 30rem),
    #f5f7fb;
}

.hero,
.panel-title,
.scope-list {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.hero {
  max-width: 72rem;
  margin: 0 auto 1.5rem;
  padding: 2.25rem;
  color: white;
  border-radius: 1.25rem;
  background: linear-gradient(125deg, #162044, #334ec5 72%, #5476ff);
  box-shadow: 0 1.25rem 3.5rem rgb(30 54 140 / 22%);
}

.hero h1 {
  margin: 0.35rem 0;
  font-size: clamp(2rem, 5vw, 3.6rem);
  line-height: 1;
  letter-spacing: -0.04em;
}

.hero p {
  max-width: 40rem;
  margin: 0.8rem 0 0;
  color: #dce4ff;
}

.eyebrow,
.step {
  color: #7890ff;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.eyebrow {
  color: #adbcff;
}

.primary-button,
.copy-button {
  flex: none;
  border: 0;
  border-radius: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  padding: 0.85rem 1.25rem;
  color: #223782;
  background: white;
  text-decoration: none;
}

.notice,
.panel,
.grid {
  max-width: 72rem;
  margin-right: auto;
  margin-left: auto;
}

.notice {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  padding: 0.8rem 1rem;
  color: #46526c;
  font-size: 0.86rem;
  border: 1px solid #dce2ef;
  border-radius: 0.8rem;
  background: rgb(255 255 255 / 76%);
}

.panel {
  padding: 1.5rem;
  border: 1px solid #e3e7f0;
  border-radius: 1rem;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 0.5rem 1.8rem rgb(31 44 83 / 6%);
}

.panel h2 {
  margin: 0.15rem 0 0;
  font-size: 1.15rem;
}

.panel p {
  color: #59647a;
}

.copy-button {
  padding: 0.55rem 0.8rem;
  color: #3853be;
  background: #eef1ff;
}

pre {
  overflow-x: auto;
  margin: 1rem 0 0;
  padding: 1rem;
  color: #d8e1ff;
  border-radius: 0.75rem;
  background: #151b2d;
}

code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.84rem;
}

.hint {
  margin-bottom: 0;
  font-size: 0.8rem;
}

.hint code {
  color: #3853be;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.grid .panel {
  margin: 0;
}

.scope-panel {
  display: grid;
  grid-template-columns: minmax(10rem, 0.6fr) minmax(0, 2fr);
  align-items: start;
  gap: 2rem;
}

.scope-list {
  align-items: stretch;
}

.scope-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem;
  color: #657086;
  border: 1px solid #e1e5ee;
  border-radius: 0.8rem;
  background: #f8f9fc;
}

.scope-item.ready {
  color: #234cb0;
  border-color: #cbd7ff;
  background: #f0f4ff;
}

.scope-item span,
.scope-item small {
  font-size: 0.76rem;
}

@media (max-width: 760px) {
  .cli-page {
    padding: 1rem;
  }

  .hero,
  .panel-title,
  .scope-list {
    align-items: flex-start;
    flex-direction: column;
  }

  .grid,
  .scope-panel {
    grid-template-columns: 1fr;
  }

  .primary-button {
    width: 100%;
    text-align: center;
  }
}
</style>
