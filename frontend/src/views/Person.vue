<template>
  <div class="page" v-loading="!p && loading">
    <template v-if="p">
      <div class="card hero">
        <div class="avatar">
          <img v-if="pf.avatar" :src="pf.avatar" alt="" />
          <span v-else>{{ pf.name?.slice(-2) }}</span>
        </div>
        <div class="who">
          <h2>{{ pf.name }}<el-tag v-if="!pf.active || pf.leaveDate" size="small" type="info" style="margin-left: 8px">已离职 {{ pf.leaveDate || '' }}</el-tag></h2>
          <div class="muted">{{ [pf.deptPath, pf.title, pf.level].filter(Boolean).join(' · ') }}</div>
          <div class="facts">
            <span v-if="pf.jobNumber">工号 {{ pf.jobNumber }}</span>
            <span v-if="pf.employmentLabel">{{ pf.employmentLabel }}</span>
            <span v-if="pf.hireDate">入职 {{ pf.hireDate }}（司龄 {{ pf.tenure }} 年）</span>
            <span v-if="pf.regularDate">转正 {{ pf.regularDate }}</span>
            <span v-if="pf.workYears != null">工龄 {{ pf.workYears }} 年</span>
            <span v-if="pf.age != null">{{ pf.gender === 'M' ? '男 · ' : pf.gender === 'F' ? '女 · ' : '' }}{{ pf.age }} 岁</span>
            <span v-if="pf.education">{{ pf.education }}{{ pf.school ? ` · ${pf.school}` : '' }}{{ pf.major ? ` · ${pf.major}` : '' }}</span>
            <span v-if="p.approver">请假审批人 {{ p.approver.name }}</span>
          </div>
          <div v-if="pf.tags.length" style="margin-top: 6px"><el-tag v-for="t in pf.tags" :key="t" size="small" effect="plain" style="margin-right: 4px">{{ t }}</el-tag></div>
        </div>
        <div class="toolbar actions">
          <el-button v-if="p.can.log1v1" type="primary" @click="one.open = true">记 1v1</el-button>
          <el-button v-if="p.can.editProfile" @click="openProfile">编辑档案</el-button>
        </div>
      </div>

      <div v-if="p.flags.length" class="card">
        <h3>要留意</h3>
        <div class="flags"><el-tag v-for="f in p.flags" :key="f.code + f.text" :type="FLAG_LEVEL[f.level]">{{ f.text }}</el-tag></div>
      </div>

      <div class="grid">
        <div v-if="p.contracts" class="card">
          <div class="toolbar between"><h3>合同与协议</h3><el-button v-if="p.can.editContracts" link type="primary" @click="newContract()">+ 新建</el-button></div>
          <div v-if="!p.contracts.length" class="muted small">还没有合同记录</div>
          <div v-for="c in p.contracts" :key="c.id" class="row-item">
            <div>
              <b>{{ c.kindLabel }}{{ c.title ? ` · ${c.title}` : '' }}</b>
              <el-tag size="small" :type="c.renewed && c.status === 'EXPIRING' ? 'info' : CONTRACT_STATUS[c.status]" style="margin-left: 6px">{{ c.statusLabel }}{{ c.status === 'EXPIRING' ? `（${c.daysLeft} 天）` : '' }}</el-tag>
              <el-tag v-if="c.renewed" size="small" type="success" style="margin-left: 4px">已续签</el-tag>
              <el-tag v-if="c.inProbation" size="small" type="warning" style="margin-left: 4px">试用期至 {{ c.probationEnd }}</el-tag>
              <div class="muted small">
                {{ c.startDate }} ~ {{ c.endDate || (c.kind === 'NON_COMPETE' ? '' : '无固定期限') }}
                <template v-if="c.kind === 'NON_COMPETE'">限制 {{ c.restrictMonths }} 个月 · 每月补偿 {{ yuan(c.monthlyComp) }}<template v-if="c.restrictWindow">（{{ c.restrictWindow.from }} ~ {{ c.restrictWindow.to }}）</template></template>
                <template v-if="c.number"> · {{ c.number }}</template>
                <template v-if="c.terminatedAt"> · {{ c.terminatedAt }} 解除{{ c.terminateReason ? `：${c.terminateReason}` : '' }}</template>
              </div>
            </div>
            <div class="toolbar">
              <a v-if="c.hasFile" :href="`api/contracts/${c.id}/file`" target="_blank">查看文件</a>
              <template v-if="p.can.editContracts">
                <el-button link type="primary" @click="editContract(c)">修改</el-button>
                <el-button v-if="c.kind === 'LABOR' && !c.renewed && ['ACTIVE', 'EXPIRING', 'EXPIRED'].includes(c.status)" link type="primary" @click="renew(c)">续签</el-button>
              </template>
            </div>
          </div>
        </div>

        <div v-if="p.cost" class="card">
          <div class="toolbar between"><h3>人员成本</h3><el-button v-if="p.can.editCost" link type="primary" @click="openCostProfile">标准成本</el-button></div>
          <div class="tiles small-tiles">
            <div class="tile"><div class="v">{{ wan(p.cost.ytd) }}</div><div class="k">今年累计</div></div>
            <div class="tile"><div class="v">{{ wan(p.cost.monthlyAvg) }}</div><div class="k">近 12 月月均</div></div>
            <div class="tile"><div class="v">{{ wan(p.cost.profile?.total) }}</div><div class="k">标准月成本</div></div>
          </div>
          <MonthBars :months="p.cost.months" :format="yuan" />
          <Bars style="margin-top: 12px" :rows="Object.entries(p.cost.ytdByCategory).map(([k, v]) => ({ key: COST_CATEGORIES[k] || k, value: v })).sort((a, b) => b.value - a.value)" :format="wan" />
        </div>

        <div class="card">
          <h3>考勤与假期</h3>
          <div class="facts col">
            <span>近 30 天考勤异常：<b :class="{ bad: p.attendance.abnormalDays30 >= 3 }">{{ p.attendance.abnormalDays30 }}</b> 天 <router-link v-if="isSelf" to="/my" class="small">看明细</router-link></span>
            <span>今年已休：<template v-if="Object.keys(p.leave.usedThisYear).length"><span v-for="(d, k) in p.leave.usedThisYear" :key="k" style="margin-right: 10px">{{ k }} {{ d }} 天</span></template><span v-else class="muted">没有</span></span>
            <span>可用余额：<span v-for="(d, k) in p.leave.balances" :key="k" style="margin-right: 10px">{{ k }} {{ d }} 天</span></span>
          </div>
        </div>

        <div class="card">
          <div class="toolbar between"><h3>1v1</h3><router-link :to="`/one-on-ones?user=${pf.id}`" class="small">全部记录</router-link></div>
          <div class="facts col">
            <span>共 {{ p.oneOnOne.count }} 次<template v-if="p.oneOnOne.last">，最近 {{ p.oneOnOne.last.date }}<template v-if="p.oneOnOne.last.nextDate">，下次 {{ p.oneOnOne.last.nextDate }}</template></template></span>
            <span v-if="p.oneOnOne.openActions">未完成待办 {{ p.oneOnOne.openActions }} 项</span>
          </div>
          <div v-if="p.oneOnOne.moods.length" class="moods">
            <div v-for="m in p.oneOnOne.moods" :key="m.date" class="mood" :title="`${m.date}：${MOODS[m.mood]}`">
              <span class="dot" :class="m.mood <= 2 ? 'low' : m.mood >= 4 ? 'high' : 'mid'">{{ m.mood }}</span>
              <span class="muted small">{{ m.date.slice(5) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 编辑档案 -->
    <el-dialog v-model="prof.open" :title="`编辑档案 · ${pf?.name}`" width="min(560px, 96vw)">
      <el-form label-width="84px" @submit.prevent>
        <el-form-item label="用工类型"><el-select v-model="prof.form.employmentType" clearable style="width: 100%"><el-option v-for="(l, k) in EMPLOYMENT" :key="k" :value="k" :label="l" /></el-select></el-form-item>
        <el-form-item label="职级"><el-input v-model="prof.form.level" maxlength="20" placeholder="如 P5、M2" /></el-form-item>
        <el-form-item label="入职日期"><el-date-picker v-model="prof.form.hireDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="转正日期"><el-date-picker v-model="prof.form.regularDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="参加工作"><el-date-picker v-model="prof.form.workStartDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="离职日期"><el-date-picker v-model="prof.form.leaveDate" value-format="YYYY-MM-DD" style="width: 100%" placeholder="竞业限制从这天起算" /></el-form-item>
        <el-form-item label="性别"><el-radio-group v-model="prof.form.gender"><el-radio value="M">男</el-radio><el-radio value="F">女</el-radio><el-radio value="">不填</el-radio></el-radio-group></el-form-item>
        <el-form-item label="出生日期"><el-date-picker v-model="prof.form.birthDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="学历"><el-select v-model="prof.form.education" clearable style="width: 100%"><el-option v-for="e in EDUCATION" :key="e" :value="e" :label="e" /></el-select></el-form-item>
        <el-form-item label="院校"><el-input v-model="prof.form.school" maxlength="100" /></el-form-item>
        <el-form-item label="专业"><el-input v-model="prof.form.major" maxlength="100" /></el-form-item>
        <el-form-item label="标签"><el-select v-model="prof.form.tags" multiple filterable allow-create default-first-option placeholder="技能、特长，回车添加" style="width: 100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="prof.open = false">取消</el-button>
        <el-button type="primary" :loading="prof.saving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>

    <!-- 标准成本 -->
    <el-dialog v-model="cp.open" title="标准月成本" width="min(460px, 96vw)">
      <p class="help">「人员成本 → 生成本月成本」按这里的数填成本表；已经录过的数不会被覆盖。</p>
      <el-form label-width="110px" @submit.prevent>
        <el-form-item v-for="(l, k) in { salary: '月应发工资', social: '社保（单位部分）', housing: '公积金（单位部分）', benefit: '福利' }" :key="k" :label="l">
          <el-input-number v-model="cp.form[k]" :min="0" :step="500" :precision="2" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="cp.form.note" maxlength="300" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cp.open = false">取消</el-button>
        <el-button type="primary" :loading="cp.saving" @click="saveCostProfile">保存</el-button>
      </template>
    </el-dialog>

    <ContractDialog v-model="ct.open" :contract="ct.contract" :renew-of="ct.renewOf" :employee="pf" lock-user @saved="load" />
    <OneOnOneDialog v-model="one.open" :employee="pf" @saved="load" />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { me } from '../me.js'
import { CONTRACT_STATUS, COST_CATEGORIES, EDUCATION, EMPLOYMENT, FLAG_LEVEL, MOODS, wan, yuan } from '../labels.js'
import Bars from '../components/Bars.vue'
import MonthBars from '../components/MonthBars.vue'
import ContractDialog from '../components/ContractDialog.vue'
import OneOnOneDialog from '../components/OneOnOneDialog.vue'

const route = useRoute()
const p = ref(null)
const loading = ref(false)
const pf = computed(() => p.value?.profile)
const isSelf = computed(() => pf.value?.id === me.user?.id)

async function load() {
  loading.value = true
  try {
    p.value = await api.get(`people/${route.params.id}`)
    document.title = `${p.value.profile.name} · 人员画像`
  } finally { loading.value = false }
}
watch(() => route.params.id, (id) => { if (id) { p.value = null; load() } }, { immediate: true })

const prof = reactive({ open: false, saving: false, form: {} })
function openProfile() {
  const f = pf.value
  prof.form = { employmentType: f.employmentType || '', level: f.level || '', hireDate: f.hireDate, regularDate: f.regularDate, workStartDate: f.workStartDate, leaveDate: f.leaveDate, gender: f.gender || '', birthDate: f.birthDate, education: f.education || '', school: f.school || '', major: f.major || '', tags: [...f.tags] }
  prof.open = true
}
async function saveProfile() {
  prof.saving = true
  try {
    const body = { ...prof.form }
    for (const k of ['hireDate', 'regularDate', 'workStartDate', 'leaveDate', 'birthDate']) body[k] = body[k] || null
    await api.patch(`people/${pf.value.id}/profile`, body)
    ElMessage.success('已保存')
    prof.open = false
    load()
  } finally { prof.saving = false }
}

const cp = reactive({ open: false, saving: false, form: {} })
function openCostProfile() {
  const x = p.value.cost.profile || {}
  cp.form = { salary: x.salary || 0, social: x.social || 0, housing: x.housing || 0, benefit: x.benefit || 0, note: x.note || '' }
  cp.open = true
}
async function saveCostProfile() {
  cp.saving = true
  try {
    await api.put(`cost/profile/${pf.value.id}`, cp.form)
    ElMessage.success('已保存')
    cp.open = false
    load()
  } finally { cp.saving = false }
}

const ct = reactive({ open: false, contract: null, renewOf: null })
const newContract = () => Object.assign(ct, { open: true, contract: null, renewOf: null })
const editContract = (c) => Object.assign(ct, { open: true, contract: c, renewOf: null })
const renew = (c) => Object.assign(ct, { open: true, contract: null, renewOf: c })

const one = reactive({ open: false })
</script>

<style scoped>
.hero { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.avatar { width: 64px; height: 64px; border-radius: 50%; background: var(--hr-primary-soft); color: var(--hr-primary); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 600; overflow: hidden; flex: none; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.who { flex: 1; min-width: 220px; }
.who h2 { margin: 0 0 4px; font-size: 20px; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 13px; }
.facts.col { flex-direction: column; }
.actions { align-self: flex-start; }
.flags { display: flex; flex-wrap: wrap; gap: 6px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.grid .card { margin-bottom: 0; }
.between { justify-content: space-between; margin-bottom: 8px; }
.between h3 { margin: 0; }
.row-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid var(--hr-border); flex-wrap: wrap; }
.row-item:first-of-type { border-top: none; }
.small-tiles { grid-template-columns: repeat(3, 1fr); }
.bad { color: var(--hr-danger); }
.moods { display: flex; gap: 10px; margin-top: 10px; }
.mood { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; color: var(--hr-on-primary); }
.dot.low { background: var(--hr-danger); }
.dot.mid { background: var(--hr-warn); }
.dot.high { background: var(--hr-ok); }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
