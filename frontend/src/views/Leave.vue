<template>
  <div class="page">
    <div class="page-head">
      <h2>请假</h2>
      <el-button type="primary" @click="openApply">申请请假</el-button>
    </div>

    <div class="tiles balances">
      <div v-for="b in balance.items" :key="b.code" class="tile link-tile" @click="openLedger(b)">
        <div class="v">{{ b.available }}<span class="unit">天</span></div>
        <div class="k">{{ balance.year }} 年{{ b.name }}可用</div>
        <div class="k">余额 {{ b.balance }} · 待审批 {{ b.pending }}</div>
      </div>
      <div v-if="!balance.items?.length" class="muted small">没有需要余额的假期类型</div>
    </div>

    <div class="card">
      <h3>我的请假</h3>
      <div class="table-wrap">
        <el-table v-loading="loading" :data="list" size="small">
          <el-table-column label="类型" min-width="70"><template #default="{ row }">{{ typeName(row.typeCode) }}</template></el-table-column>
          <el-table-column label="时间" min-width="200"><template #default="{ row }">{{ range(row) }}</template></el-table-column>
          <el-table-column label="天数" prop="days" width="60" />
          <el-table-column label="状态" min-width="80"><template #default="{ row }"><el-tag :type="LEAVE_STATUS[row.status]" size="small">{{ row.statusLabel }}</el-tag></template></el-table-column>
          <el-table-column label="审批人" min-width="80"><template #default="{ row }">{{ row.decider?.name || row.approver?.name || '人事' }}</template></el-table-column>
          <el-table-column label="事由 / 意见" min-width="160">
            <template #default="{ row }">{{ row.reason }}<div v-if="row.decisionNote" class="muted small">意见：{{ row.decisionNote }}</div></template>
          </el-table-column>
          <el-table-column label="" width="70" fixed="right">
            <template #default="{ row }"><el-button v-if="canCancel(row)" link type="danger" @click="cancel(row)">撤销</el-button></template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="apply.open" title="申请请假" width="min(520px, 94vw)">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="类型">
          <el-select v-model="apply.form.typeCode" style="width: 100%">
            <el-option v-for="t in types" :key="t.code" :value="t.code" :label="t.name">
              {{ t.name }}<span class="muted small" style="margin-left: 8px">{{ t.unit === 'DAY' ? '按整天' : '可请半天' }}</span>
            </el-option>
          </el-select>
          <div v-if="curType?.note" class="help">{{ curType.note }}</div>
        </el-form-item>
        <el-form-item label="开始">
          <div class="row">
            <el-date-picker v-model="apply.form.startDate" value-format="YYYY-MM-DD" :clearable="false" style="flex: 1" />
            <el-select v-if="half" v-model="apply.form.startHalf" style="width: 90px"><el-option value="AM" label="上午" /><el-option value="PM" label="下午" /></el-select>
          </div>
        </el-form-item>
        <el-form-item label="结束">
          <div class="row">
            <el-date-picker v-model="apply.form.endDate" value-format="YYYY-MM-DD" :clearable="false" style="flex: 1" />
            <el-select v-if="half" v-model="apply.form.endHalf" style="width: 90px"><el-option value="AM" label="上午" /><el-option value="PM" label="下午" /></el-select>
          </div>
        </el-form-item>
        <el-form-item label="天数">
          <b>{{ apply.estimate ?? '-' }}</b><span class="muted small" style="margin-left: 8px">按工作日计，周末和节假日不算</span>
        </el-form-item>
        <el-form-item label="事由"><el-input v-model="apply.form.reason" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="apply.open = false">取消</el-button>
        <el-button type="primary" :loading="apply.saving" :disabled="!apply.estimate" @click="submit">提交</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="ledger.open" :title="`${ledger.title} · 余额明细`" size="min(520px, 100vw)">
      <el-table :data="ledger.rows" size="small">
        <el-table-column label="时间" min-width="140"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="类型" min-width="80"><template #default="{ row }">{{ LEDGER_KIND[row.kind] || row.kind }}</template></el-table-column>
        <el-table-column label="天数" min-width="60"><template #default="{ row }">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</template></el-table-column>
        <el-table-column label="说明" prop="note" min-width="160" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { LEAVE_STATUS, LEDGER_KIND, fmtTime, range, today } from '../labels.js'

const balance = ref({ items: [] })
const list = ref([])
const types = ref([])
const loading = ref(false)
const typeName = (c) => types.value.find(t => t.code === c)?.name || c

const apply = reactive({ open: false, saving: false, estimate: null, form: {} })
const curType = computed(() => types.value.find(t => t.code === apply.form.typeCode))
const half = computed(() => curType.value?.unit !== 'DAY')

async function load() {
  loading.value = true
  try {
    ;[balance.value, list.value] = await Promise.all([api.get('balance/mine'), api.get('leave/mine')])
  } finally { loading.value = false }
}
onMounted(async () => { types.value = await api.get('leave/types'); load() })

function openApply() {
  const d = today()
  apply.form = { typeCode: types.value[0]?.code, startDate: d, startHalf: 'AM', endDate: d, endHalf: 'PM', reason: '' }
  apply.open = true
}

let seq = 0
watch(() => [apply.open, apply.form.typeCode, apply.form.startDate, apply.form.startHalf, apply.form.endDate, apply.form.endHalf], async () => {
  if (!apply.open) return
  if (!half.value) { apply.form.startHalf = 'AM'; apply.form.endHalf = 'PM' }
  const f = apply.form
  if (!f.startDate || !f.endDate || f.endDate < f.startDate) { apply.estimate = null; return }
  const n = ++seq
  try {
    const r = await api.get('leave/estimate', { startDate: f.startDate, startHalf: f.startHalf, endDate: f.endDate, endHalf: f.endHalf, typeCode: f.typeCode })
    if (n === seq) apply.estimate = r.days
  } catch { if (n === seq) apply.estimate = null }
})

async function submit() {
  apply.saving = true
  try {
    const r = await api.post('leave', apply.form)
    ElMessage.success(`已提交，等${r.approver?.name || '人事'}审批`)
    apply.open = false
    load()
  } finally { apply.saving = false }
}

const canCancel = (r) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today())
async function cancel(r) {
  await ElMessageBox.confirm(`撤销 ${range(r)} 的${typeName(r.typeCode)}？${r.status === 'APPROVED' ? '已扣的余额会退回。' : ''}`, '撤销请假', { type: 'warning' })
  await api.post(`leave/${r.id}/cancel`)
  ElMessage.success('已撤销')
  load()
}

const ledger = reactive({ open: false, title: '', rows: [] })
async function openLedger(b) {
  ledger.title = `${balance.value.year} 年${b.name}`
  ledger.rows = await api.get('balance/ledger', { typeCode: b.code, year: balance.value.year })
  ledger.open = true
}
</script>

<style scoped>
.row { display: flex; gap: 8px; width: 100%; }
.unit { font-size: 13px; font-weight: 400; margin-left: 2px; }
.link-tile { cursor: pointer; }
.link-tile:hover { border-color: var(--hr-primary); }
.balances { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
</style>
