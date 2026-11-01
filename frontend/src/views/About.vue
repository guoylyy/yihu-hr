<template>
  <div class="page">
    <div class="page-head about-head">
      <h2>关于</h2>
      <p class="help">报问题时把这一页截图发给管理员。</p>
    </div>
    <section class="card" v-loading="loading">
      <dl class="info">
        <div><dt>版本号</dt><dd>{{ me.version ? `v${me.version}` : '—' }}</dd></div>
        <div><dt>构建时间</dt><dd>{{ buildTime }}</dd></div>
        <div><dt>运行模式</dt><dd>{{ me.platform?.connected ? '以虎 One 平台' : '本地开发' }}</dd></div>
        <div><dt>数据目录</dt><dd>{{ info.dataDir || '不用本地目录（数据在数据库，文件在平台文件存储）' }}</dd></div>
        <div><dt>数据库版本</dt><dd>{{ info.database || '—' }}</dd></div>
        <div><dt>AI 模型</dt><dd>{{ info.model || '未启用' }}</dd></div>
        <div><dt>Node 版本</dt><dd>{{ info.node || '—' }}</dd></div>
      </dl>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'
import { me } from '../me.js'
import { fmtTime } from '../labels.js'

// 构建时写入（vite.config.js）
const buildTime = fmtTime(__BUILD_TIME__)
const info = ref({})
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try { info.value = await api.get('about') } finally { loading.value = false }
})
</script>

<style scoped>
.about-head { display: block; }
.about-head .help { margin: 4px 0 0; }
.info { margin: 0; }
.info div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--yh-border-soft); }
.info div:last-child { border-bottom: 0; }
.info dt { color: var(--hr-muted); }
.info dd { margin: 0; word-break: break-word; font-variant-numeric: tabular-nums; }
@media (max-width: 760px) {
  .info div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
</style>
