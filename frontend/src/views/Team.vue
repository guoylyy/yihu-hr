<template>
  <div class="page wide">
    <div class="page-head">
      <h2>团队考勤</h2>
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 170px" @change="load" />
        <el-checkbox v-if="data?.exemptCount" v-model="showExempt" @change="load">显示免考勤的 {{ data.exemptCount }} 人</el-checkbox>
        <el-radio-group v-model="view" size="default">
          <el-radio-button value="status">看状态</el-radio-button>
          <el-radio-button value="time">看时间</el-radio-button>
        </el-radio-group>
        <el-button-group>
          <el-button :icon="ArrowLeft" @click="go(-1)" />
          <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 130px" class="month-pick" @change="load" />
          <el-button :icon="ArrowRight" @click="go(1)" />
        </el-button-group>
        <el-button @click="exportCsv">导出月报</el-button>
      </div>
    </div>

    <div v-if="data" class="tiles">
      <div class="tile"><div class="v">{{ t.people }}</div><div class="k">人数</div></div>
      <div class="tile good"><div class="v">{{ t.normalRate ?? '—' }}<span class="unit">%</span></div><div class="k">正常出勤率（去掉请假、出差）</div></div>
      <div class="tile" :class="{ bad: t.late }"><div class="v">{{ t.late }}</div><div class="k">迟到（人次）</div></div>
      <div class="tile" :class="{ bad: t.early }"><div class="v">{{ t.early }}</div><div class="k">早退（人次）</div></div>
      <div class="tile" :class="{ bad: t.missing }"><div class="v">{{ t.missing }}</div><div class="k">缺卡（人次）</div></div>
      <div class="tile" :class="{ bad: t.absent }"><div class="v">{{ t.absent }}</div><div class="k">旷工（人次）</div></div>
      <div class="tile"><div class="v">{{ days(t.leaveDays) }}</div><div class="k">请假（人天）</div></div>
      <div class="tile"><div class="v">{{ days(t.tripDays) }}</div><div class="k">出差（人天）</div></div>
      <div class="tile" :class="{ warn: t.noData }"><div class="v">{{ t.noData }}</div><div class="k">无记录（人天）</div></div>
    </div>

    <div class="card matrix-card" v-loading="loading">
      <div v-if="data && !data.rows.length" class="muted">没有人</div>
      <div v-else-if="data" class="matrix-wrap">
        <table class="matrix" :class="`v-${view}`">
          <thead>
            <tr>
              <th class="name sticky" @click="sortBy('name')">员工 <SortMark k="name" :sort="sort" /></th>
              <th v-for="d in data.days" :key="d.date" class="day" :class="{ rest: !d.workday, today: d.date === data.today }">
                <div>{{ Number(d.date.slice(8)) }}</div><div class="wk">{{ WEEK[d.weekday] }}</div>
              </th>
              <th v-for="c in SUM" :key="c.k" class="sum" :title="c.title" @click="sortBy(c.k)">{{ c.label }} <SortMark :k="c.k" :sort="sort" /></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.employee.id" :class="{ exempt: r.exempt }">
              <td class="name sticky">
                <router-link :to="{ path: '/my', query: { userId: r.employee.id, month } }" class="who">{{ r.employee.name }}</router-link><ExemptTag :value="r.employee.exemption" />
                <div class="dept">{{ r.employee.deptPath }}</div>
              </td>
              <td v-for="(c, i) in r.cells" :key="i" class="cell" :class="[cls(c, data.days[i]), { rest: !data.days[i].workday }]" :title="tip(r, c, data.days[i])">
                <template v-if="view === 'status'">{{ glyph(c, data.days[i]) }}</template>
                <template v-else-if="c.firstIn || c.lastOut"><div>{{ c.firstIn || '—' }}</div><div>{{ c.lastOut || '—' }}</div></template>
                <template v-else>{{ glyph(c, data.days[i]) }}</template>
              </td>
              <td v-for="c in SUM" :key="c.k" class="sum" :class="{ hot: c.bad && r[c.k] }">{{ fmtSum(r[c.k]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="legend small muted">
        <span><i class="sq c-ok">✓</i>正常</span><span><i class="sq c-bad">迟</i>迟到</span><span><i class="sq c-bad">退</i>早退</span><span><i class="sq c-bad">缺</i>缺卡</span>
        <span><i class="sq c-bad">旷</i>旷工</span><span><i class="sq c-bad">地</i>地点异常</span><span><i class="sq c-leave">假</i>请假（半天的显示「半」）</span>
        <span><i class="sq c-trip">差</i>出差</span><span><i class="sq c-out">外</i>外出</span><span><i class="sq c-warn">?</i>无记录</span><span><i class="sq c-rest" />休息日</span>
        <span>点名字看这个人的考勤日历；把鼠标放在格子上看时间和明细</span>
        <span v-if="data?.exemptCount">免考勤的人（如董事、高管）不算进上面的指标{{ showExempt ? '，列在最后' : '' }}；在人员画像的「编辑档案」里设</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '../api.js'
import { FLAG, WEEK, addMonth, days, thisMonth } from '../labels.js'
import ExemptTag from '../components/ExemptTag.vue'

const SUM = [
  { k: 'normal', label: '正常', title: '正常出勤的天数' }, { k: 'late', label: '迟到', bad: true }, { k: 'early', label: '早退', bad: true },
  { k: 'missing', label: '缺卡', bad: true }, { k: 'absent', label: '旷工', bad: true }, { k: 'location', label: '地点', bad: true, title: '地点异常' },
  { k: 'leaveDays', label: '请假', title: '请假天数（工作日）' }, { k: 'tripDays', label: '出差', title: '出差天数（工作日）' }, { k: 'noData', label: '无记录', title: '工作日既没有打卡也没有请假 / 出差' }
]

const route = useRoute()
const router = useRouter()
const month = ref(route.query.month || thisMonth())
const keyword = ref('')
const view = ref('status')
const showExempt = ref(false)
const data = ref(null)
const loading = ref(false)
const sort = ref({ k: null, desc: true })
const t = computed(() => data.value?.totals || {})

async function load() {
  loading.value = true
  try { data.value = await api.get('attendance/report', { month: month.value, keyword: keyword.value, includeExempt: showExempt.value ? 1 : undefined }) } finally { loading.value = false }
}
function go(n) {
  month.value = addMonth(month.value, n)
  router.replace({ query: { ...route.query, month: month.value } })
}
watch(() => route.query.month, (m) => { if (m) { month.value = m; load() } })
onMounted(load)
const exportCsv = () => window.open(api.url('attendance/report.csv', { month: month.value, keyword: keyword.value, includeExempt: showExempt.value ? 1 : undefined }), '_blank')

function sortBy(k) {
  sort.value = sort.value.k === k ? { k, desc: !sort.value.desc } : { k, desc: k !== 'name' }
}
const rows = computed(() => {
  const list = [...(data.value?.rows || [])]
  const { k, desc } = sort.value
  if (!k) return list
  // 免考勤的始终排在最后
  const v = (r) => (k === 'name' ? r.employee.name : r[k])
  return list.sort((a, b) => (a.exempt - b.exempt) || (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * (desc ? -1 : 1))
})
const fmtSum = (n) => (n ? days(n) : '')

const half = (c) => c.leave.reduce((s, l) => s + l.units, 0)
function glyph(c, d) {
  if (c.status === 'LEAVE') return half(c) < 0.99 ? '半' : '假'
  if (c.status === 'TRIP') return '差'
  if (c.status === 'OUT') return '外'
  if (c.status === 'NO_DATA') return '?'
  if (c.status === 'FUTURE') return ''
  if (c.status === 'REST') return c.away.some(a => a.category === 'TRIP') ? '差' : ''
  if (c.status === 'ABNORMAL') {
    const f = c.flags
    if (f.includes('ABSENT')) return '旷'
    if (f.includes('MISSING')) return '缺'
    if (f.includes('LATE') || f.includes('SERIOUS_LATE')) return '迟'
    if (f.includes('EARLY')) return '退'
    if (f.includes('LOCATION')) return '地'
    return '!'
  }
  // 正常但有半天假 / 外出
  if (c.leave.length) return '半'
  if (c.away.length) return c.away[0].category === 'TRIP' ? '差' : '外'
  return '✓'
}
function cls(c, d) {
  if (c.status === 'ABNORMAL') return 'c-bad'
  if (c.status === 'LEAVE' || (c.status === 'NORMAL' && c.leave.length)) return 'c-leave'
  if (c.status === 'TRIP' || (c.status === 'REST' && c.away.some(a => a.category === 'TRIP'))) return 'c-trip'
  if (c.status === 'OUT' || (c.status === 'NORMAL' && c.away.length)) return 'c-out'
  if (c.status === 'NO_DATA') return 'c-warn'
  if (c.status === 'NORMAL') return 'c-ok'
  return ''
}
function tip(r, c, d) {
  const lines = [`${r.employee.name} · ${d.date} 周${WEEK[d.weekday]}`]
  if (c.firstIn || c.lastOut) lines.push(`上班 ${c.firstIn || '—'}  下班 ${c.lastOut || '—'}`)
  if (c.flags.length) lines.push(c.flags.map(f => FLAG[f] || f).join('、'))
  for (const l of c.leave) lines.push(`${l.name || '请假'} ${days(l.units)} 天`)
  for (const a of c.away) lines.push(a.category === 'TRIP' ? '出差' : a.name || '外出')
  if (c.status === 'NO_DATA') lines.push('没有打卡记录')
  return lines.join('\n')
}

// 表头上的排序箭头
const SortMark = (props) => (props.sort.k === props.k ? h('span', { class: 'sort' }, props.sort.desc ? '↓' : '↑') : null)
SortMark.props = ['k', 'sort']
</script>

<style scoped>
.unit { font-size: 13px; font-weight: 400; margin-left: 2px; }
.matrix-card { padding: 0; overflow: hidden; }
.matrix-wrap { overflow: auto; max-height: calc(100vh - 260px); min-height: 200px; }
.matrix { border-collapse: separate; border-spacing: 0; font-size: 12px; width: max-content; min-width: 100%; }
.matrix th, .matrix td { border-bottom: 1px solid var(--hr-border); border-right: 1px solid var(--hr-border); text-align: center; padding: 0; }
.matrix thead th { position: sticky; top: 0; background: var(--hr-surface); z-index: 2; font-weight: 500; color: var(--hr-muted); padding: 4px 0; cursor: default; }
.matrix th.sum { cursor: pointer; padding: 4px 6px; white-space: nowrap; }
.matrix th.name { cursor: pointer; }
.sticky { position: sticky; left: 0; background: var(--hr-surface); z-index: 1; text-align: left !important; padding: 4px 10px !important; min-width: 130px; max-width: 170px; }
thead .sticky { z-index: 3; }
.who { font-weight: 600; font-size: 13px; }
.dept { color: var(--hr-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.day { width: 30px; min-width: 30px; }
.day .wk { font-size: 10px; }
.day.today { color: var(--hr-primary); font-weight: 700; }
.day.rest, td.rest { background: var(--hr-bg); }
.cell { height: 34px; font-weight: 600; cursor: default; }
.v-time .cell { font-size: 10px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; width: 40px; min-width: 40px; }
.v-time .day { width: 40px; min-width: 40px; }
.c-ok { color: var(--hr-ok); }
.c-bad { background: var(--el-color-danger-light-9) !important; color: var(--hr-danger); }
.c-leave { background: var(--el-color-primary-light-9) !important; color: var(--el-color-primary-dark-2); }
.c-trip { background: #f3f0ff !important; color: #6d28d9; }
.c-out { background: #f0f9ff !important; color: #0369a1; }
.c-warn { color: var(--hr-warn); }
td.sum { padding: 0 6px; font-variant-numeric: tabular-nums; min-width: 40px; }
td.sum.hot { color: var(--hr-danger); font-weight: 700; }
tbody tr:hover td { filter: brightness(0.97); }
tbody tr:hover .sticky { background: var(--hr-primary-soft); }
.sort { color: var(--hr-primary); }
tr.exempt td { opacity: 0.55; }
tr.exempt .sticky { opacity: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 10px 12px; border-top: 1px solid var(--hr-border); }
.sq { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; border-radius: 3px; font-style: normal; font-weight: 600; margin-right: 4px; border: 1px solid var(--hr-border); }
.sq.c-rest { background: var(--hr-bg); }
.month-pick :deep(.el-input__wrapper) { border-radius: 0; }
</style>
