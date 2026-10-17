<template>
  <div class="page">
    <div class="page-head"><h2>审批</h2></div>
    <el-tabs v-model="tab">
      <el-tab-pane :label="`待我审批${pending.length ? `（${pending.length}）` : ''}`" name="pending">
        <div v-if="!pending.length && !loading" class="card muted">没有等你审批的请假</div>
        <div v-for="r in pending" :key="r.id" class="card item">
          <div class="main">
            <div><b>{{ r.employee?.name }}</b><span class="muted small" style="margin-left: 8px">{{ r.employee?.deptPath }}</span></div>
            <div>{{ typeName(r.typeCode) }} · {{ r.days }} 天 · {{ range(r) }}</div>
            <div v-if="r.reason" class="muted pre">事由：{{ r.reason }}</div>
            <div class="muted small">提交于 {{ fmtTime(r.createdAt) }}<span v-if="!r.approver">（未指定审批人，由人事审批）</span></div>
          </div>
          <div class="ops">
            <el-button type="primary" @click="decide(r, true)">批准</el-button>
            <el-button @click="decide(r, false)">驳回</el-button>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="me.team" label="团队请假记录" name="team">
        <div class="toolbar" style="margin-bottom: 12px">
          <el-select v-model="filter.status" clearable placeholder="全部状态" style="width: 130px" @change="loadTeam">
            <el-option v-for="(v, k) in STATUS_TEXT" :key="k" :value="k" :label="v" />
          </el-select>
          <el-date-picker v-model="filter.range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" style="width: 260px" @change="loadTeam" />
        </div>
        <div class="card table-wrap">
          <el-table v-loading="loading" :data="team" size="small">
            <el-table-column label="员工" min-width="90"><template #default="{ row }">{{ row.employee?.name }}</template></el-table-column>
            <el-table-column label="部门" min-width="140"><template #default="{ row }">{{ row.employee?.deptPath }}</template></el-table-column>
            <el-table-column label="类型" min-width="70"><template #default="{ row }">{{ typeName(row.typeCode) }}</template></el-table-column>
            <el-table-column label="时间" min-width="200"><template #default="{ row }">{{ range(row) }}</template></el-table-column>
            <el-table-column label="天数" prop="days" width="60" />
            <el-table-column label="状态" min-width="80"><template #default="{ row }"><el-tag :type="LEAVE_STATUS[row.status]" size="small">{{ row.statusLabel }}</el-tag></template></el-table-column>
            <el-table-column label="审批人" min-width="80"><template #default="{ row }">{{ row.decider?.name || row.approver?.name || '人事' }}</template></el-table-column>
            <el-table-column v-if="me.hr" label="" width="70" fixed="right">
              <template #default="{ row }"><el-button v-if="row.status === 'APPROVED'" link type="danger" @click="hrCancel(row)">撤销</el-button></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { me } from '../me.js'
import { LEAVE_STATUS, fmtTime, range } from '../labels.js'

const STATUS_TEXT = { PENDING: '待审批', APPROVED: '已批准', REJECTED: '已驳回', CANCELLED: '已撤销' }
const tab = ref('pending')
const pending = ref([])
const team = ref([])
const types = ref([])
const loading = ref(false)
const filter = reactive({ status: '', range: null })
const typeName = (c) => types.value.find(t => t.code === c)?.name || c

async function loadPending() {
  loading.value = true
  try { pending.value = await api.get('leave/pending') } finally { loading.value = false }
}
async function loadTeam() {
  loading.value = true
  try { team.value = await api.get('leave/team', { status: filter.status, from: filter.range?.[0], to: filter.range?.[1] }) } finally { loading.value = false }
}
watch(tab, (t) => (t === 'team' ? loadTeam() : loadPending()))
onMounted(async () => { types.value = await api.get('leave/types', { all: 1 }); loadPending() })

async function decide(r, approve) {
  let note = ''
  if (approve) {
    await ElMessageBox.confirm(`批准 ${r.employee?.name} ${r.days} 天${typeName(r.typeCode)}？`, '批准', { type: 'success' })
  } else {
    const res = await ElMessageBox.prompt('驳回原因（会发给申请人）', '驳回', { inputValidator: (v) => !!String(v || '').trim() || '写一下原因' })
    note = res.value
  }
  await api.post(`leave/${r.id}/decide`, { approve, note })
  ElMessage.success(approve ? '已批准' : '已驳回')
  loadPending()
}

async function hrCancel(r) {
  const res = await ElMessageBox.prompt(`撤销 ${r.employee?.name} 已批准的请假，余额会退回。说明：`, '撤销请假', { inputValidator: (v) => !!String(v || '').trim() || '写一下原因' })
  await api.post(`leave/${r.id}/cancel`, { note: res.value })
  ElMessage.success('已撤销')
  loadTeam()
}
</script>

<style scoped>
.item { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.item .main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ops { display: flex; gap: 8px; }
</style>
