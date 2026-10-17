<template>
  <div v-loading="loading">
    <p class="help">平台通讯录 {{ status?.employees ?? '-' }} 人。钉钉、飞书直接用以虎 One「管理 → 登录方式」里配好的那个应用（不用再配密钥，但要在开发者后台给它开通考勤权限）；企业微信打卡要单独的「打卡」应用 Secret，写进服务器上的 <code>apps/hr/.env</code>。</p>
    <div v-for="s in status?.sources || []" :key="s.source" class="card">
      <div class="head">
        <h3>{{ s.label }}</h3>
        <el-tag v-if="s.credSource === 'PLATFORM'" type="success" size="small">用以虎 One 登录方式里的{{ s.label }}应用</el-tag>
        <el-tag v-else-if="s.credSource === 'OWN'" type="success" size="small">用本应用配的凭证</el-tag>
        <el-tag v-else-if="s.configured" type="success" size="small">已配置</el-tag>
        <el-tag v-else type="info" size="small">未配置</el-tag>
        <el-tag v-if="s.running" type="warning" size="small">同步中</el-tag>
        <el-button v-if="s.configured" size="small" style="margin-left: auto" :loading="busy === s.source" @click="run({ source: s.source })">立即同步</el-button>
      </div>
      <div v-if="!s.configured && s.setupHint" class="help">{{ s.setupHint }}<span v-if="s.platformError" class="muted">（平台返回：{{ s.platformError }}）</span></div>
      <div v-if="s.runs.length" class="table-wrap">
        <el-table :data="s.runs.slice(0, 5)" size="small">
          <el-table-column label="开始" min-width="140"><template #default="{ row }">{{ fmtTime(row.startedAt) }}</template></el-table-column>
          <el-table-column label="方式" min-width="56"><template #default="{ row }">{{ row.trigger === 'MANUAL' ? '手动' : '定时' }}</template></el-table-column>
          <el-table-column label="日期范围" min-width="170"><template #default="{ row }">{{ row.dateFrom ? `${row.dateFrom} ~ ${row.dateTo}` : '' }}</template></el-table-column>
          <el-table-column label="结果" min-width="70">
            <template #default="{ row }">
              <el-tag v-if="row.ok === true" type="success" size="small">成功</el-tag>
              <el-tag v-else-if="row.ok === false" type="danger" size="small">失败</el-tag>
              <el-tag v-else size="small" type="info">进行中</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="拉取 / 保存" min-width="90"><template #default="{ row }">{{ row.fetched }} / {{ row.saved }}</template></el-table-column>
          <el-table-column label="说明" min-width="200"><template #default="{ row }"><span :class="{ bad: row.ok === false }">{{ row.error }}</span></template></el-table-column>
        </el-table>
      </div>
      <el-collapse v-if="s.configured && s.unmatchedPeople.length" style="margin-top: 8px">
        <el-collapse-item :title="`${s.unmatchedPeople.length} 人对不上${s.label}身份（打卡不会同步）`">
          <div v-if="s.hint" class="help">{{ s.hint }}</div>
          <div class="small">{{ s.unmatchedPeople.map(p => p.name + (p.jobNumber ? `(${p.jobNumber})` : '')).join('、') }}</div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="card">
      <h3>补拉历史</h3>
      <p class="help">把一段时间的打卡重新从所有已配置的来源拉一遍（一次最多 62 天）。重复拉不会重复记。</p>
      <div class="toolbar">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" style="width: 260px" />
        <el-button type="primary" :disabled="!range" :loading="busy === 'ALL'" @click="run({ from: range[0], to: range[1] }, 'ALL')">开始</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api.js'
import { fmtTime } from '../../labels.js'

const status = ref(null)
const loading = ref(false)
const busy = ref('')
const range = ref(null)

async function load() {
  loading.value = true
  try { status.value = await api.get('sync/status') } finally { loading.value = false }
}
onMounted(load)

async function run(body, key) {
  busy.value = key || body.source
  try {
    const out = await api.post('sync/run', body)
    const errs = out.filter(r => r.error)
    const skipped = out.filter(r => r.skipped)
    if (errs.length) ElMessage.error(errs.map(e => `${e.source}：${e.error}`).join('；'))
    else if (skipped.length && skipped.length === out.length) ElMessage.info(skipped.map(s => s.skipped).join('；'))
    else ElMessage.success('同步完成')
  } finally {
    busy.value = ''
    load()
  }
}
</script>

<style scoped>
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.head h3 { margin: 0; }
.bad { color: var(--hr-danger); }
code { background: var(--hr-bg); padding: 1px 4px; border-radius: 4px; }
</style>
