<template>
  <div class="page">
    <div class="page-head">
      <h2>假期余额</h2>
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 170px" @change="load" />
        <el-date-picker v-model="yearStr" type="year" value-format="YYYY" :clearable="false" style="width: 110px" @change="load" />
      </div>
    </div>
    <div class="toolbar" style="margin-bottom: 12px">
      <el-button type="primary" @click="grantPreview">发放 {{ year }} 年年假</el-button>
      <el-button @click="openAdjust()">调整余额</el-button>
      <el-button @click="carryPreview">{{ year }} 年年末结转</el-button>
      <el-button @click="imp.open = true">批量导入日期</el-button>
    </div>

    <div class="card table-wrap">
      <el-table v-loading="loading" :data="data.rows" size="small">
        <el-table-column label="员工" min-width="90" fixed><template #default="{ row }">{{ row.employee.name }}</template></el-table-column>
        <el-table-column label="部门" min-width="150"><template #default="{ row }">{{ row.employee.deptPath }}</template></el-table-column>
        <el-table-column label="入职日期" prop="hireDate" min-width="100" />
        <el-table-column label="参加工作" min-width="100">
          <template #default="{ row }"><span v-if="row.workStartDate">{{ row.workStartDate }}</span><span v-else class="warn">未填</span></template>
        </el-table-column>
        <el-table-column label="审批人" min-width="80"><template #default="{ row }">{{ row.approver?.name || '' }}</template></el-table-column>
        <el-table-column v-for="t in data.types" :key="t.code" :label="t.name" min-width="90" align="right">
          <template #default="{ row }">
            <span class="link" @click="openLedger(row, t)">{{ row.balances[t.code]?.balance ?? 0 }}</span>
            <span v-if="row.balances[t.code]?.pending" class="muted small">（待 {{ row.balances[t.code].pending }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" @click="openAdjust(row)">调整</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <p class="help">年假按《职工带薪年休假条例》：累计工作满 1 年 5 天、满 10 年 10 天、满 20 年 15 天；新入职或年中跨档的按当年在本单位的天数折算。需要先填「参加工作日期」，入职日期不填按全年算。</p>

    <!-- 编辑人事字段 -->
    <el-dialog v-model="edit.open" :title="`编辑 · ${edit.name}`" width="min(460px, 94vw)">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="入职日期"><el-date-picker v-model="edit.form.hireDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="参加工作"><el-date-picker v-model="edit.form.workStartDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="指定审批人">
          <EmployeePicker v-model="edit.form.approverId" :initial="edit.approver" placeholder="不指定则找部门负责人，再找人事" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.open = false">取消</el-button>
        <el-button type="primary" :loading="edit.saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 调整 -->
    <el-dialog v-model="adj.open" title="调整余额" width="min(460px, 94vw)">
      <el-form label-width="70px" @submit.prevent>
        <el-form-item label="员工"><EmployeePicker v-model="adj.form.userId" :initial="adj.employee" /></el-form-item>
        <el-form-item label="年份"><el-input-number v-model="adj.form.year" :min="2000" :max="2100" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="adj.form.typeCode" style="width: 100%"><el-option v-for="t in data.types" :key="t.code" :value="t.code" :label="t.name" /></el-select>
        </el-form-item>
        <el-form-item label="天数"><el-input-number v-model="adj.form.delta" :step="0.5" :precision="1" /><span class="muted small" style="margin-left: 8px">正数加、负数扣</span></el-form-item>
        <el-form-item label="原因"><el-input v-model="adj.form.note" maxlength="300" placeholder="如：10 月加班 2 天转调休" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adj.open = false">取消</el-button>
        <el-button type="primary" :loading="adj.saving" @click="saveAdjust">保存</el-button>
      </template>
    </el-dialog>

    <!-- 发放年假预览 -->
    <el-dialog v-model="grant.open" :title="`发放 ${year} 年年假`" width="min(760px, 96vw)">
      <p v-if="grant.data">要变动 <b>{{ grant.data.changed }}</b> 人（没变化的不动）。已发过的人重新核算后补差额。</p>
      <el-alert v-if="grant.data?.missing.length" type="warning" :closable="false" style="margin-bottom: 10px"
        :title="`${grant.data.missing.length} 人没填参加工作日期，这次不发：${grant.data.missing.slice(0, 20).map(e => e.name).join('、')}${grant.data.missing.length > 20 ? ' …' : ''}`" />
      <div class="table-wrap">
        <el-table :data="grant.data?.rows.filter(r => r.delta !== 0) || []" size="small" max-height="400">
          <el-table-column label="员工" min-width="90"><template #default="{ row }">{{ row.employee.name }}</template></el-table-column>
          <el-table-column label="已发" prop="before" min-width="60" />
          <el-table-column label="应发" prop="days" min-width="60" />
          <el-table-column label="变动" min-width="60"><template #default="{ row }">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</template></el-table-column>
          <el-table-column label="依据" min-width="260">
            <template #default="{ row }"><div v-for="s in row.segments" :key="s.from" class="small">{{ s.from }} ~ {{ s.to }}：每年 {{ s.perYear }} 天</div></template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="grant.open = false">取消</el-button>
        <el-button type="primary" :disabled="!grant.data?.changed" :loading="grant.saving" @click="grantConfirm">确认发放</el-button>
      </template>
    </el-dialog>

    <!-- 年末结转预览 -->
    <el-dialog v-model="carry.open" :title="`${year} 年年假年末结转`" width="min(640px, 96vw)">
      <p v-if="carry.data">每人最多转 <b>{{ carry.data.maxDays }}</b> 天到 {{ year + 1 }} 年，其余清零（上限在「设置 → 规则」里改）。共 {{ carry.data.rows.length }} 人。</p>
      <el-alert v-if="carry.data?.skippedPending" type="warning" :closable="false" style="margin-bottom: 10px"
        :title="`${carry.data.skippedPending} 人还有待审批的年假，这次跳过，审批完再结转一次`" />
      <div class="table-wrap">
        <el-table :data="carry.data?.rows || []" size="small" max-height="400">
          <el-table-column label="员工" min-width="90"><template #default="{ row }">{{ row.employee?.name }}</template></el-table-column>
          <el-table-column label="剩余" prop="remaining" min-width="70" />
          <el-table-column label="结转" prop="carry" min-width="70" />
          <el-table-column label="清零" min-width="70"><template #default="{ row }">{{ Math.round((row.remaining - row.carry) * 10) / 10 }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="carry.open = false">取消</el-button>
        <el-button type="primary" :disabled="!carry.data?.rows.length" :loading="carry.saving" @click="carryConfirm">确认结转</el-button>
      </template>
    </el-dialog>

    <!-- 批量导入日期 -->
    <el-dialog v-model="imp.open" title="批量导入入职 / 参加工作日期" width="min(560px, 96vw)">
      <p class="help">每行一人：工号或姓名, 入职日期, 参加工作日期（逗号或 Tab 分隔，可直接从表格粘贴）。日期写 YYYY-MM-DD，不改的列留空。</p>
      <el-input v-model="imp.text" type="textarea" :rows="10" placeholder="E0052, 2021-03-15, 2012-07-01&#10;张三, 2024-09-01, 2019-07-01" />
      <template #footer>
        <el-button @click="imp.open = false">取消</el-button>
        <el-button type="primary" :loading="imp.saving" @click="saveImport">导入</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="ledger.open" :title="ledger.title" size="min(520px, 100vw)">
      <el-table :data="ledger.rows" size="small">
        <el-table-column label="时间" min-width="140"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="类型" min-width="80"><template #default="{ row }">{{ LEDGER_KIND[row.kind] || row.kind }}</template></el-table-column>
        <el-table-column label="天数" min-width="60"><template #default="{ row }">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</template></el-table-column>
        <el-table-column label="说明" prop="note" min-width="180" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { LEDGER_KIND, fmtTime, thisYear } from '../labels.js'
import EmployeePicker from '../components/EmployeePicker.vue'

const yearStr = ref(String(thisYear()))
const year = computed(() => Number(yearStr.value))
const keyword = ref('')
const data = ref({ rows: [], types: [] })
const loading = ref(false)

async function load() {
  loading.value = true
  try { data.value = await api.get('balance/table', { year: year.value, keyword: keyword.value }) } finally { loading.value = false }
}
onMounted(load)

const edit = reactive({ open: false, saving: false, id: null, name: '', approver: null, form: {} })
function openEdit(row) {
  Object.assign(edit, { open: true, id: row.employee.id, name: row.employee.name, approver: row.approver, form: { hireDate: row.hireDate, workStartDate: row.workStartDate, approverId: row.approver?.id ?? null } })
}
async function saveEdit() {
  edit.saving = true
  try {
    await api.patch(`employees/${edit.id}`, { hireDate: edit.form.hireDate || null, workStartDate: edit.form.workStartDate || null, approverId: edit.form.approverId || null })
    ElMessage.success('已保存')
    edit.open = false
    load()
  } finally { edit.saving = false }
}

const adj = reactive({ open: false, saving: false, employee: null, form: {} })
function openAdjust(row) {
  adj.employee = row?.employee || null
  adj.form = { userId: row?.employee.id ?? null, year: year.value, typeCode: data.value.types[0]?.code, delta: 1, note: '' }
  adj.open = true
}
async function saveAdjust() {
  if (!adj.form.userId) return ElMessage.warning('选一个员工')
  adj.saving = true
  try {
    await api.post('balance/adjust', adj.form)
    ElMessage.success('已调整')
    adj.open = false
    load()
  } finally { adj.saving = false }
}

const grant = reactive({ open: false, saving: false, data: null })
async function grantPreview() {
  grant.data = await api.post('balance/grant-annual', { year: year.value, preview: true })
  grant.open = true
}
async function grantConfirm() {
  grant.saving = true
  try {
    const r = await api.post('balance/grant-annual', { year: year.value, preview: false })
    ElMessage.success(`已发放，变动 ${r.changed} 人`)
    grant.open = false
    load()
  } finally { grant.saving = false }
}

const carry = reactive({ open: false, saving: false, data: null })
async function carryPreview() {
  carry.data = await api.post('balance/carry-over', { fromYear: year.value, preview: true })
  carry.open = true
}
async function carryConfirm() {
  await ElMessageBox.confirm('结转后这些人本年的年假余额清零，不能撤回（可以手工调整补回）。继续？', '年末结转', { type: 'warning' })
  carry.saving = true
  try {
    const r = await api.post('balance/carry-over', { fromYear: year.value, preview: false })
    ElMessage.success(`已结转 ${r.rows.length} 人`)
    carry.open = false
    load()
  } finally { carry.saving = false }
}

const imp = reactive({ open: false, saving: false, text: '' })
async function saveImport() {
  imp.saving = true
  try {
    const r = await api.post('employees/import-dates', { text: imp.text })
    ElMessage.success(`已导入 ${r.saved} 人`)
    imp.open = false
    imp.text = ''
    load()
  } finally { imp.saving = false }
}

const ledger = reactive({ open: false, title: '', rows: [] })
async function openLedger(row, t) {
  ledger.title = `${row.employee.name} · ${year.value} 年${t.name}`
  ledger.rows = await api.get('balance/ledger', { userId: row.employee.id, typeCode: t.code, year: year.value })
  ledger.open = true
}
</script>

<style scoped>
.warn { color: var(--hr-warn); }
</style>
