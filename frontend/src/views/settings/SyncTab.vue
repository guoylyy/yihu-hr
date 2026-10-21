<template>
  <div v-loading="loading">
    <p class="help">平台通讯录 {{ status?.employees ?? '-' }} 人。每次同步拉打卡结果，以及审批通过的请假、出差、外出（钉钉只有请假）。钉钉、飞书直接用以虎 One「管理 → 登录方式」里配好的那个应用（不用再配密钥，但要在开发者后台给它开通考勤权限）；企业微信打卡要单独的「打卡」应用 Secret，写进服务器上的 <code>apps/hr/.env</code>。</p>
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
      <!-- 请假 / 出差 / 外出：和打卡一起同步，结果单独看 -->
      <div v-if="s.configured && s.absence" class="absence" :class="{ bad: s.absence.last && !s.absence.last.ok }">
        <div class="row">
          <b>请假 / 出差 / 外出</b>
          <el-tag v-if="!s.absence.last" size="small" type="info">还没同步过</el-tag>
          <el-tag v-else-if="s.absence.last.ok" size="small" type="success">上次成功 {{ fmtTime(s.absence.last.at) }}</el-tag>
          <el-tag v-else size="small" type="danger">上次失败 {{ fmtTime(s.absence.last.at) }}</el-tag>
          <span class="muted small">已有：请假 {{ s.absence.counts.LEAVE || 0 }} · 出差 {{ s.absence.counts.TRIP || 0 }} · 外出 {{ s.absence.counts.OUT || 0 }} 条</span>
        </div>
        <div class="small muted">能拿到：{{ s.absence.covers }}<template v-if="s.absence.last?.from">；上次拉 {{ s.absence.last.from }} ~ {{ s.absence.last.to }}，{{ s.absence.last.saved }} 条</template></div>
        <div v-if="s.absence.last?.error" class="small" :class="s.absence.last.ok ? 'muted' : 'err'">{{ s.absence.last.ok ? '' : '出错：' }}{{ s.absence.last.error }}</div>
        <div v-if="s.absence.last && !s.absence.last.ok" class="small">怎么办：{{ s.absence.hint }}。开好后点「立即同步」，第一次成功时会把最近 90 天的请假补拉回来。</div>
      </div>
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
          <el-table-column label="打卡 拉取 / 保存" min-width="110"><template #default="{ row }">{{ row.fetched }} / {{ row.saved }}</template></el-table-column>
          <el-table-column label="请假等" min-width="64">
            <template #default="{ row }"><span v-if="row.absenceOk === false" class="err">失败</span><span v-else-if="row.absenceOk">{{ row.absences }}</span></template>
          </el-table-column>
          <el-table-column label="说明" min-width="200">
            <template #default="{ row }"><span :class="{ err: row.ok === false }">{{ row.error }}</span><span v-if="row.absenceError" :class="row.absenceOk === false ? 'err' : 'muted'">{{ row.error ? '；' : '' }}{{ row.absenceOk === false ? '请假：' : '' }}{{ row.absenceError }}</span></template>
          </el-table-column>
        </el-table>
      </div>
      <el-collapse v-if="s.configured && s.unmatchedPeople.length" style="margin-top: 8px">
        <el-collapse-item :title="`${s.unmatchedPeople.length} 人对不上${s.label}身份（打卡不会同步）`">
          <div v-if="s.hint" class="help">{{ s.hint }}</div>
          <div class="small">{{ s.unmatchedPeople.map(p => p.name + (p.jobNumber ? `(${p.jobNumber})` : '')).join('、') }}</div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- 从钉钉 / 飞书补全档案 -->
    <div v-if="prof" class="card">
      <div class="head">
        <h3>从钉钉 / 飞书补全档案</h3>
        <el-tag v-if="!prof.enabled" size="small" type="info">每天自动补全已关（设置 → 规则）</el-tag>
        <el-tag v-if="prof.conflicts.length" size="small" type="warning">{{ prof.conflicts.length }} 处要你选</el-tag>
        <el-button size="small" style="margin-left: auto" :loading="busy === 'PROFILE'" @click="runProfiles">立即补全</el-button>
      </div>
      <p class="help">平台通讯录只有姓名、部门、工号这些。人事在钉钉智能人事 / 飞书里维护的入职日期、转正日期、出生日期、性别、学历、用工类型，每天拉完通讯录后读过来比一遍：这里空的补上；钉钉 / 飞书上改了的跟着改；这里改过而那边没改的保留；第一次比两边不一样的列在下面让你选。工号只补空的。</p>
      <div v-if="prof.last" class="small" :class="{ err: prof.last.ok === false }">
        上次 {{ fmtTime(prof.last.startedAt) }}：<template v-if="prof.last.ok !== false">读了 {{ prof.last.fetched }} 人，改了 {{ prof.last.saved }} 人，新冲突 {{ prof.last.unmatched }} 处</template><template v-else>失败</template>
        <span v-if="prof.last.error" :class="prof.last.ok === false ? 'err' : 'muted'">；{{ prof.last.error }}</span>
      </div>
      <div v-else class="small muted">还没补全过</div>
      <template v-if="prof.conflicts.length">
        <div class="toolbar" style="margin: 10px 0 6px">
          <b class="small">两边不一样</b>
          <el-button size="small" :disabled="!conf.sel.length" @click="resolve('VENDOR', conf.sel)">选中的用钉钉 / 飞书的</el-button>
          <el-button size="small" :disabled="!conf.sel.length" @click="resolve('APP', conf.sel)">选中的保留这里的</el-button>
          <el-button size="small" link type="primary" @click="resolve('VENDOR')">全部用钉钉 / 飞书的</el-button>
        </div>
        <div class="table-wrap">
          <el-table :data="prof.conflicts" size="small" max-height="360" @selection-change="conf.sel = $event.map(r => r.id)">
            <el-table-column type="selection" width="36" />
            <el-table-column label="员工" min-width="90"><template #default="{ row }"><router-link :to="`/people/${row.employee?.id}`">{{ row.employee?.name }}</router-link></template></el-table-column>
            <el-table-column label="字段" prop="label" min-width="80" />
            <el-table-column label="这里" min-width="100"><template #default="{ row }">{{ show(row.field, row.before) }}</template></el-table-column>
            <el-table-column label="钉钉 / 飞书" min-width="110"><template #default="{ row }"><b>{{ show(row.field, row.after) }}</b> <span class="muted small">{{ SOURCE[row.source] }}</span></template></el-table-column>
            <el-table-column label="" width="150">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="resolve('VENDOR', [row.id])">用那边的</el-button>
                <el-button link size="small" @click="resolve('APP', [row.id])">保留这里的</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <el-collapse v-if="prof.recent.length" style="margin-top: 8px">
        <el-collapse-item :title="`最近按钉钉 / 飞书改的（${prof.recent.length}）`">
          <div v-for="c in prof.recent" :key="c.id" class="small">
            {{ fmtTime(c.at) }} · {{ c.employee?.name }} · {{ c.label }}：{{ show(c.field, c.before) || '空' }} → <b>{{ show(c.field, c.after) }}</b> <span class="muted">（{{ SOURCE[c.source] }}）</span>
          </div>
        </el-collapse-item>
      </el-collapse>
      <div v-for="x in prof.sources.filter(x => x.configured)" :key="x.source" class="help">{{ x.label }}：{{ x.hint }}</div>
    </div>

    <div class="card">
      <h3>补拉历史</h3>
      <p class="help">把一段时间的打卡和请假 / 出差 / 外出重新从所有已配置的来源拉一遍（一次最多 62 天）。重复拉不会重复记、不会重复扣余额。</p>
      <div class="toolbar">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" style="width: 260px" />
        <el-button type="primary" :disabled="!range" :loading="busy === 'ALL'" @click="run({ from: range[0], to: range[1] }, 'ALL')">开始</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api.js'
import { EMPLOYMENT, SOURCE, fmtTime } from '../../labels.js'

const status = ref(null)
const loading = ref(false)
const busy = ref('')
const range = ref(null)

const prof = ref(null)
const conf = reactive({ sel: [] })
async function load() {
  loading.value = true
  try { [status.value, prof.value] = await Promise.all([api.get('sync/status'), api.get('sync/profiles')]) } finally { loading.value = false }
}
const show = (field, v) => (v == null ? '' : field === 'gender' ? ({ M: '男', F: '女' }[v] || v) : field === 'employmentType' ? (EMPLOYMENT[v] || v) : v)
async function runProfiles() {
  busy.value = 'PROFILE'
  try {
    const r = await api.post('sync/profiles')
    if (r.skipped) ElMessage.info(r.skipped)
    else ElMessage.success(`读了 ${r.people} 人：补上 ${r.filled} 项、按钉钉 / 飞书更新 ${r.updated} 项、新冲突 ${r.conflicts} 处`)
  } finally {
    busy.value = ''
    load()
  }
}
async function resolve(use, ids) {
  if (!ids) await ElMessageBox.confirm(`${prof.value.conflicts.length} 处全部用钉钉 / 飞书上的值？`, '处理冲突', { type: 'warning' })
  const r = await api.post('sync/profiles/resolve', { use, ids })
  ElMessage.success(`已处理 ${r.resolved} 处`)
  load()
}
onMounted(load)

async function run(body, key) {
  busy.value = key || body.source
  try {
    const out = await api.post('sync/run', body)
    const errs = out.filter(r => r.error)
    const skipped = out.filter(r => r.skipped)
    const warns = out.filter(r => r.warning)
    if (errs.length) ElMessage.error(errs.map(e => `${e.source}：${e.error}`).join('；'))
    else if (warns.length) ElMessage.warning(`打卡同步完成；${warns.map(w => `${w.source}${w.warning}`).join('；')}`)
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
.err { color: var(--hr-danger); }
.absence { margin: 8px 0; padding: 8px 12px; border-radius: 8px; background: var(--hr-bg); display: flex; flex-direction: column; gap: 4px; }
.absence.bad { background: var(--el-color-danger-light-9); }
.absence .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
code { background: var(--hr-bg); padding: 1px 4px; border-radius: 4px; }
</style>
