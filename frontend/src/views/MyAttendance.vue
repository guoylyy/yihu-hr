<template>
  <div class="page wide">
    <div class="page-head">
      <h2>{{ title }}<span v-if="other" class="muted sub">{{ data.employee.deptPath }}</span></h2>
      <div class="toolbar">
        <el-button v-if="userId" text @click="$router.push({ path: '/my', query: { month } })">看我自己的</el-button>
        <el-button v-if="userId && me.team" text @click="$router.push({ path: `/people/${userId}` })">画像</el-button>
        <el-button-group>
          <el-button :icon="ArrowLeft" @click="go(-1)" />
          <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 130px" class="month-pick" @change="load" />
          <el-button :icon="ArrowRight" @click="go(1)" />
        </el-button-group>
      </div>
    </div>

    <el-alert v-if="data?.employee.exemption" type="info" :closable="false" style="margin-bottom: 12px"
      :title="`${data.employee.name}${data.employee.exemption === 'FULL' ? '免考勤、不参与考核' : '免考勤'}${data.exemptNote ? `（${data.exemptNote}）` : ''}：这里照常显示同步来的记录，但不算进团队考勤和出勤率`" />
    <div v-if="data" class="strip">
      <span>应出勤 <b>{{ s.workdays }}</b> 天</span>
      <span class="ok">正常 <b>{{ s.normal }}</b></span>
      <span :class="{ bad: s.late }">迟到 <b>{{ s.late }}</b></span>
      <span :class="{ bad: s.early }">早退 <b>{{ s.early }}</b></span>
      <span :class="{ bad: s.missing }">缺卡 <b>{{ s.missing }}</b></span>
      <span :class="{ bad: s.absent }">旷工 <b>{{ s.absent }}</b></span>
      <span v-if="s.location" class="bad">地点异常 <b>{{ s.location }}</b></span>
      <span>请假 <b>{{ days(s.leaveDays) }}</b> 天<template v-if="leaveNames">（{{ leaveNames }}）</template></span>
      <span>出差 <b>{{ days(s.tripDays) }}</b> 天</span>
      <span v-if="s.outDays">外出 <b>{{ s.outDays }}</b> 次</span>
      <span :class="{ warn: s.noData }">无记录 <b>{{ s.noData }}</b></span>
    </div>

    <div class="layout">
      <div class="card cal-card" v-loading="loading">
        <MonthCalendar v-if="data" :days="data.days" :today="data.today" :picked="picked?.date" @pick="pick" />
        <div class="legend small muted">
          <span><i class="dot ok" />正常</span><span><i class="dot bad" />异常（时间标红是迟到 / 早退 / 缺卡）</span>
          <span><i class="dot leave" />请假</span><span><i class="dot trip" />出差</span><span><i class="dot out" />外出</span><span><i class="dot warn" />无记录</span>
        </div>
      </div>

      <!-- 这一天的明细 -->
      <div class="card day-card">
        <template v-if="picked">
          <div class="toolbar between">
            <h3>{{ picked.date }} 周{{ weekdayOf(picked.date) }}<span v-if="!picked.workday" class="muted small">（休息日）</span></h3>
            <StatusTag v-if="picked.status !== 'FUTURE'" :status="picked.status" :flags="picked.flags" />
          </div>
          <div class="kv"><span class="muted">上班</span><b>{{ picked.firstIn || '—' }}</b><span class="muted">下班</span><b>{{ picked.lastOut || '—' }}</b></div>
          <div v-if="picked.leaveTypes.length || picked.away.length" class="section">
            <div v-for="l in picked.leaveTypes" :key="'l' + (l.absenceId || l.requestId)" class="line">
              <span class="chip leave">{{ l.name || '请假' }}</span><span>这天 {{ days(l.units) }} 天</span><span class="muted small">{{ SOURCE[l.source] || l.source }}</span>
            </div>
            <div v-for="a in picked.away" :key="'a' + a.absenceId" class="line">
              <span class="chip" :class="a.category === 'TRIP' ? 'trip' : 'out'">{{ a.category === 'TRIP' ? '出差' : a.name || '外出' }}</span>
              <span v-if="a.units">这天 {{ days(a.units) }} 天</span><span class="muted small">{{ SOURCE[a.source] || a.source }}</span>
            </div>
            <div v-for="a in absOf(picked.date)" :key="'s' + a.id" class="muted small">{{ a.typeName || a.categoryLabel }}：{{ span(a) }}<template v-if="a.reportedDays">，共 {{ days(a.reportedDays) }} 天</template></div>
          </div>
          <div class="section">
            <div v-if="!picked.records.length" class="muted small">这天没有打卡记录</div>
            <div v-for="r in picked.records" :key="r.id" class="punch">
              <b class="t">{{ r.time || '未打卡' }}</b>
              <span>{{ KIND[r.kind] || r.kind }}</span>
              <span :class="r.result === 'NORMAL' ? 'ok' : 'bad'">{{ FLAG[r.result] || r.result }}</span>
              <span v-if="r.planTime" class="muted small">应 {{ r.planTime }}</span>
              <el-tag size="small" type="info" disable-transitions>{{ r.sourceLabel }}</el-tag>
              <div v-if="r.location || r.note" class="muted small full">{{ [r.location, r.note].filter(Boolean).join(' · ') }}</div>
              <el-button v-if="me.hr && r.source === 'MANUAL'" link type="danger" size="small" @click="delPunch(r)">删除</el-button>
            </div>
          </div>
          <el-button v-if="me.hr" size="small" @click="openPatch">补录打卡</el-button>
        </template>
        <div v-else class="muted small">点日历上的一天看明细：每次打卡的时间、来源、地点，当天的请假和出差。</div>
      </div>
    </div>

    <!-- 原始记录 -->
    <div class="card">
      <div class="toolbar between">
        <h3>原始记录</h3>
        <div class="toolbar">
          <el-radio-group v-model="tab" size="small">
            <el-radio-button value="punch">打卡（{{ punches.length }}）</el-radio-button>
            <el-radio-button value="absence">请假 / 出差 / 外出（{{ data?.absences.length || 0 }}）</el-radio-button>
          </el-radio-group>
          <el-button size="small" @click="exportCsv">导出 CSV</el-button>
        </div>
      </div>
      <div class="table-wrap">
        <el-table v-if="tab === 'punch'" :data="punches" size="small" max-height="460">
          <el-table-column label="日期" min-width="100"><template #default="{ row }">{{ row.date.slice(5) }} 周{{ weekdayOf(row.date) }}</template></el-table-column>
          <el-table-column label="类型" min-width="56"><template #default="{ row }">{{ KIND[row.kind] || row.kind }}</template></el-table-column>
          <el-table-column label="打卡时间" min-width="76"><template #default="{ row }"><b>{{ row.time || '—' }}</b></template></el-table-column>
          <el-table-column label="应打卡" prop="planTime" min-width="70" />
          <el-table-column label="结果" min-width="80"><template #default="{ row }"><span :class="row.result === 'NORMAL' ? '' : 'bad'">{{ FLAG[row.result] || row.result }}</span></template></el-table-column>
          <el-table-column label="来源" prop="sourceLabel" min-width="80" />
          <el-table-column label="地点 / 说明" min-width="200"><template #default="{ row }">{{ [row.location, row.note].filter(Boolean).join(' · ') }}</template></el-table-column>
        </el-table>
        <el-table v-else :data="data?.absences || []" size="small" max-height="460">
          <el-table-column label="类别" min-width="60"><template #default="{ row }">{{ row.categoryLabel }}</template></el-table-column>
          <el-table-column label="类型" min-width="80"><template #default="{ row }">{{ row.typeName || '—' }}</template></el-table-column>
          <el-table-column label="时间" min-width="230"><template #default="{ row }">{{ span(row) }}</template></el-table-column>
          <el-table-column label="时长" min-width="90"><template #default="{ row }">{{ row.reportedDays != null ? days(row.reportedDays) + ' 天' : row.hours != null ? row.hours + ' 小时' : '' }}</template></el-table-column>
          <el-table-column label="计入工作日" min-width="90"><template #default="{ row }">{{ days(row.workDays) }} 天</template></el-table-column>
          <el-table-column label="来源" prop="sourceLabel" min-width="80" />
        </el-table>
      </div>
      <p class="help">打卡、请假、出差、外出都以钉钉 / 飞书 / 企业微信为准（在那边提交和审批），定时同步过来。有出入请找人事补录或在原系统里更正。</p>
    </div>

    <el-dialog v-model="patch.open" :title="`补录打卡 · ${data?.employee.name} · ${picked?.date}`" width="min(440px, 94vw)">
      <el-form label-width="70px" @submit.prevent>
        <el-form-item label="类型">
          <el-radio-group v-model="patch.form.kind"><el-radio value="IN">上班</el-radio><el-radio value="OUT">下班</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="时间"><el-time-picker v-model="patch.form.time" format="HH:mm" value-format="HH:mm" :clearable="false" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="patch.form.note" type="textarea" :rows="2" maxlength="500" placeholder="如：忘记打卡，已核实" /></el-form-item>
      </el-form>
      <p class="help">补录后这一天的这一类打卡以补录为准。</p>
      <template #footer>
        <el-button @click="patch.open = false">取消</el-button>
        <el-button type="primary" :loading="patch.saving" @click="savePatch">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '../api.js'
import { me } from '../me.js'
import { FLAG, KIND, SOURCE, addMonth, days, span, thisMonth, weekdayOf } from '../labels.js'
import StatusTag from '../components/StatusTag.vue'
import MonthCalendar from '../components/MonthCalendar.vue'

const route = useRoute()
const router = useRouter()
const month = ref(route.query.month || thisMonth())
const userId = computed(() => route.query.userId)
const data = ref(null)
const loading = ref(false)
const picked = ref(null)
const tab = ref('punch')
const s = computed(() => data.value?.summary || {})
const other = computed(() => data.value && data.value.employee.id !== me.user?.id)
const title = computed(() => (other.value ? `${data.value.employee.name}的考勤` : '我的考勤'))
const leaveNames = computed(() => Object.entries(s.value.leaveByType || {}).map(([k, v]) => `${k} ${days(v)}`).join('、'))
const punches = computed(() => (data.value?.days || []).flatMap(d => d.records.map(r => ({ ...r, date: d.date }))))
const absOf = (date) => (data.value?.absences || []).filter(a => a.startDate <= date && a.endDate >= date)

async function load() {
  loading.value = true
  try {
    data.value = await api.get('attendance/month', { month: month.value, userId: userId.value })
    // 默认选中今天（本月）或这个月第一个异常的日子
    const keep = picked.value && data.value.days.find(d => d.date === picked.value.date)
    picked.value = keep || data.value.days.find(d => d.date === data.value.today) || data.value.days.find(d => d.status === 'ABNORMAL') || null
  } finally { loading.value = false }
}
function go(n) {
  month.value = addMonth(month.value, n)
  router.replace({ query: { ...route.query, month: month.value } })
}
const pick = (d) => { picked.value = d }
watch(() => route.query, (q) => { if (q.month) month.value = q.month; load() })
onMounted(load)

const exportCsv = () => window.open(api.url('attendance/records.csv', { month: month.value, userId: userId.value }), '_blank')

const patch = reactive({ open: false, saving: false, form: {} })
function openPatch() {
  const d = picked.value
  patch.form = { userId: data.value.employee.id, date: d.date, kind: d.firstIn ? 'OUT' : 'IN', time: d.firstIn ? '18:00' : '09:00', note: '' }
  patch.open = true
}
async function savePatch() {
  patch.saving = true
  try {
    await api.post('attendance/punches', patch.form)
    ElMessage.success('已补录')
    patch.open = false
    load()
  } finally { patch.saving = false }
}
async function delPunch(r) {
  await ElMessageBox.confirm(`删除这条补录（${KIND[r.kind]} ${r.time}）？`, '删除补录', { type: 'warning' })
  await api.del(`attendance/punches/${r.id}`)
  ElMessage.success('已删除')
  load()
}
</script>

<style scoped>
.sub { font-size: 13px; font-weight: normal; margin-left: 10px; }
.strip { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 14px; margin-bottom: 12px; background: var(--hr-surface); border: 1px solid var(--hr-border); border-radius: var(--hr-radius); font-size: 13px; color: var(--hr-muted); }
.strip b { color: var(--hr-text); font-size: 15px; margin: 0 1px; }
.strip .ok b { color: var(--hr-ok); }
.strip .bad b { color: var(--hr-danger); }
.strip .warn b { color: var(--hr-warn); }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.cal-card { padding: 12px; }
.day-card { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 10px; }
.day-card h3 { margin: 0; }
.between { justify-content: space-between; }
.kv { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 4px 8px; align-items: baseline; font-variant-numeric: tabular-nums; }
.kv b { font-size: 16px; }
.section { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--hr-border); padding-top: 8px; }
.line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.punch { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.punch .t { font-variant-numeric: tabular-nums; min-width: 44px; }
.full { flex-basis: 100%; }
.ok { color: var(--hr-ok); }
.bad { color: var(--hr-danger); }
.chip { font-size: 12px; line-height: 20px; padding: 0 6px; border-radius: 4px; }
.chip.leave { background: var(--el-color-primary-light-8); color: var(--el-color-primary-dark-2); }
.chip.trip { background: #ede9fe; color: #6d28d9; }
.chip.out { background: #e0f2fe; color: #0369a1; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: 0; }
.dot.ok { background: var(--hr-ok); } .dot.bad { background: var(--hr-danger); } .dot.warn { background: var(--hr-warn); }
.dot.leave { background: var(--el-color-primary-light-3); } .dot.trip { background: #8b5cf6; } .dot.out { background: #0ea5e9; }
.month-pick :deep(.el-input__wrapper) { border-radius: 0; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .day-card { position: static; }
}
</style>
