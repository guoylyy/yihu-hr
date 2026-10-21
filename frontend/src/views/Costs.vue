<template>
  <div class="page">
    <div class="page-head">
      <h2>人员成本</h2>
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 170px" @change="load" />
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 130px" @change="load" />
      </div>
    </div>
    <div v-if="data.canEdit" class="toolbar" style="margin-bottom: 12px">
      <el-button type="primary" @click="genPreview">生成 {{ month }} 成本</el-button>
      <el-button @click="imp.open = true">导入</el-button>
      <span class="muted small">按每人的「标准成本」和竞业协议补齐这个月，已经录过的数不动；奖金、培训等一次性的用导入或点格子录</span>
    </div>

    <div class="tiles">
      <div class="tile"><div class="v">{{ wan(data.total) }}</div><div class="k">{{ month }} 合计</div></div>
      <div class="tile"><div class="v">{{ data.headcount }}</div><div class="k">人数</div></div>
      <div class="tile"><div class="v">{{ wan(data.headcount ? data.total / data.headcount : null) }}</div><div class="k">人均</div></div>
      <div v-if="summary" class="tile"><div class="v">{{ wan(summary.total) }}</div><div class="k">{{ month.slice(0, 4) }} 年累计</div></div>
    </div>

    <div class="grid">
      <div v-if="summary" class="card">
        <h3>{{ month.slice(0, 4) }} 年每月</h3>
        <MonthBars :months="yearMonths" :format="yuan" />
      </div>
      <div v-if="summary" class="card">
        <h3>按部门（今年）</h3>
        <Bars :rows="Object.entries(summary.byDept).map(([k, v]) => ({ key: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 10)" :format="wan" />
      </div>
    </div>

    <div class="card table-wrap" v-loading="loading">
      <el-table :data="data.rows" size="small" show-summary :summary-method="sumRow">
        <el-table-column label="员工" min-width="90" fixed>
          <template #default="{ row }"><router-link :to="`/people/${row.employee.id}`">{{ row.employee.name }}</router-link><ExemptTag :value="row.employee.exemption === 'FULL' ? 'FULL' : null" /></template>
        </el-table-column>
        <el-table-column label="部门" min-width="130"><template #default="{ row }">{{ row.employee.deptPath }}</template></el-table-column>
        <el-table-column v-for="c in columns" :key="c" :label="COST_CATEGORIES[c]" min-width="96" align="right">
          <template #default="{ row }">
            <span :class="{ link: data.canEdit, auto: row.items[c] && row.items[c].source !== 'MANUAL' && row.items[c].source !== 'IMPORT' }" :title="row.items[c]?.note || ''" @click="data.canEdit && editCell(row, c)">
              {{ row.items[c] ? num(row.items[c].amount) : (data.canEdit ? '＋' : '') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="合计" min-width="100" align="right" fixed="right"><template #default="{ row }"><b>{{ num(row.total) }}</b></template></el-table-column>
        <el-table-column v-if="data.canEdit" label="标准月成本" min-width="110" align="right">
          <template #default="{ row }"><span class="link" @click="editProfile(row)">{{ row.profile ? num(row.profile.total) : '设置' }}</span></template>
        </el-table-column>
      </el-table>
    </div>
    <p class="help">金额是单位承担的成本（应发工资、单位缴的社保公积金等），不是到手工资。灰色斜体是按标准或协议自动生成的。<template v-if="!data.canEdit">你看到的是下属的成本，只有人事能改。</template></p>

    <!-- 录一个格子 -->
    <el-dialog v-model="cell.open" :title="`${cell.name} · ${month} · ${COST_CATEGORIES[cell.category]}`" width="min(400px, 94vw)">
      <el-form label-width="60px" @submit.prevent>
        <el-form-item label="金额"><el-input-number v-model="cell.amount" :min="0" :step="100" :precision="2" style="width: 200px" /><span class="muted small" style="margin-left: 8px">0 = 删除</span></el-form-item>
        <el-form-item label="备注"><el-input v-model="cell.note" maxlength="300" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cell.open = false">取消</el-button>
        <el-button type="primary" :loading="cell.saving" @click="saveCell">保存</el-button>
      </template>
    </el-dialog>

    <!-- 标准成本 -->
    <el-dialog v-model="prof.open" :title="`标准月成本 · ${prof.name}`" width="min(440px, 96vw)">
      <el-form label-width="110px" @submit.prevent>
        <el-form-item v-for="(l, k) in { salary: '月应发工资', social: '社保（单位部分）', housing: '公积金（单位部分）', benefit: '福利' }" :key="k" :label="l">
          <el-input-number v-model="prof.form[k]" :min="0" :step="500" :precision="2" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="prof.form.note" maxlength="300" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="prof.open = false">取消</el-button>
        <el-button type="primary" :loading="prof.saving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>

    <!-- 生成预览 -->
    <el-dialog v-model="gen.open" :title="`生成 ${month} 成本`" width="min(640px, 96vw)">
      <p v-if="gen.data">要补 <b>{{ gen.data.count }}</b> 个数，合计 {{ yuan(gen.data.total) }}。已经有的数不动。</p>
      <el-alert v-if="gen.data?.noProfile.length" type="warning" :closable="false" style="margin-bottom: 10px"
        :title="`${gen.data.noProfile.length} 人没设标准成本，这次不生成：${gen.data.noProfile.slice(0, 15).map(e => e.name).join('、')}${gen.data.noProfile.length > 15 ? ' …' : ''}`" />
      <el-table :data="gen.data?.rows || []" size="small" max-height="360">
        <el-table-column label="员工" prop="name" min-width="90" />
        <el-table-column label="类别" min-width="100"><template #default="{ row }">{{ COST_CATEGORIES[row.category] }}</template></el-table-column>
        <el-table-column label="金额" min-width="100" align="right"><template #default="{ row }">{{ num(row.amount) }}</template></el-table-column>
        <el-table-column label="说明" prop="note" min-width="160" />
      </el-table>
      <template #footer>
        <el-button @click="gen.open = false">取消</el-button>
        <el-button type="primary" :disabled="!gen.data?.count" :loading="gen.saving" @click="genConfirm">确认生成</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="imp.open" :title="`导入 ${month} 成本`" width="min(600px, 96vw)">
      <p class="help">每行一个数：工号或姓名, 类别, 金额[, 备注]（逗号或 Tab 分隔，可从表格粘贴）。类别写中文（{{ Object.values(COST_CATEGORIES).map(l => l.replace(/（.*）/, '')).join('、') }}）。同一人同一类已经有的会被覆盖。</p>
      <el-input v-model="imp.text" type="textarea" :rows="8" placeholder="E0052, 奖金, 8000, Q3 绩效&#10;张三, 培训, 1200, 外训" />
      <div v-if="imp.result" style="margin-top: 10px">
        <div>能导入 <b>{{ imp.result.ok.length }}</b> 行，合计 {{ yuan(imp.result.total) }}</div>
        <el-alert v-for="b in imp.result.bad" :key="b.line" type="error" :closable="false" :title="`第 ${b.line} 行：${b.error}（${b.text}）`" style="margin-top: 4px" />
      </div>
      <template #footer>
        <el-button @click="imp.open = false">取消</el-button>
        <el-button @click="importRun(true)">检查</el-button>
        <el-button type="primary" :disabled="!imp.result || imp.result.bad.length || !imp.result.ok.length" :loading="imp.saving" @click="importRun(false)">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { COST_CATEGORIES, thisMonth, wan, yuan } from '../labels.js'
import Bars from '../components/Bars.vue'
import MonthBars from '../components/MonthBars.vue'
import ExemptTag from '../components/ExemptTag.vue'

const month = ref(thisMonth())
const keyword = ref('')
const data = ref({ rows: [], total: 0 })
const summary = ref(null)
const loading = ref(false)
const num = (v) => Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })

// 列：常用的四项总是显示，其余有数才显示
const columns = computed(() => {
  const used = new Set(data.value.rows.flatMap(r => Object.keys(r.items)))
  return Object.keys(COST_CATEGORIES).filter(c => ['SALARY', 'SOCIAL', 'HOUSING', 'BONUS'].includes(c) || used.has(c))
})
const yearMonths = computed(() => Array.from({ length: 12 }, (_, i) => {
  const m = `${month.value.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`
  return { month: m, amount: summary.value?.byMonth[m] || 0 }
}))

async function load() {
  loading.value = true
  try {
    ;[data.value, summary.value] = await Promise.all([api.get('cost/table', { month: month.value, keyword: keyword.value }), api.get('cost/summary', { year: month.value.slice(0, 4) })])
  } finally { loading.value = false }
}
onMounted(load)

function sumRow({ columns: cols }) {
  return cols.map((c, i) => {
    if (i === 0) return '合计'
    const cat = columns.value[i - 2]
    if (cat) return num(data.value.rows.reduce((a, r) => a + (r.items[cat]?.amount || 0), 0))
    if (c.label === '合计') return num(data.value.total)
    return ''
  })
}

const cell = reactive({ open: false, saving: false })
function editCell(row, c) {
  Object.assign(cell, { open: true, userId: row.employee.id, name: row.employee.name, category: c, amount: row.items[c]?.amount || 0, note: row.items[c]?.note || '' })
}
async function saveCell() {
  cell.saving = true
  try {
    await api.post('cost/item', { userId: cell.userId, month: month.value, category: cell.category, amount: cell.amount, note: cell.note })
    cell.open = false
    load()
  } finally { cell.saving = false }
}

const prof = reactive({ open: false, saving: false, form: {} })
function editProfile(row) {
  const p = row.profile || {}
  Object.assign(prof, { open: true, userId: row.employee.id, name: row.employee.name, form: { salary: p.salary || 0, social: p.social || 0, housing: p.housing || 0, benefit: p.benefit || 0, note: p.note || '' } })
}
async function saveProfile() {
  prof.saving = true
  try {
    await api.put(`cost/profile/${prof.userId}`, prof.form)
    ElMessage.success('已保存')
    prof.open = false
    load()
  } finally { prof.saving = false }
}

const gen = reactive({ open: false, saving: false, data: null })
async function genPreview() {
  gen.data = await api.post('cost/generate', { month: month.value, preview: true })
  gen.open = true
}
async function genConfirm() {
  gen.saving = true
  try {
    const r = await api.post('cost/generate', { month: month.value, preview: false })
    ElMessage.success(`已生成 ${r.count} 个数`)
    gen.open = false
    load()
  } finally { gen.saving = false }
}

const imp = reactive({ open: false, saving: false, text: '', result: null })
async function importRun(preview) {
  imp.saving = !preview
  try {
    imp.result = await api.post('cost/import', { month: month.value, text: imp.text, preview })
    if (!preview && imp.result.saved) {
      ElMessage.success(`已导入 ${imp.result.saved} 行`)
      Object.assign(imp, { open: false, text: '', result: null })
      load()
    }
  } finally { imp.saving = false }
}
</script>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.auto { font-style: italic; color: var(--hr-muted); }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
