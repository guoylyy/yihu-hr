<template>
  <div class="page">
    <div class="page-head">
      <h2>月度报表</h2>
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 180px" @change="load" />
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 140px" @change="load" />
        <el-button @click="exportCsv">导出 CSV</el-button>
      </div>
    </div>
    <div class="card table-wrap">
      <el-table v-loading="loading" :data="rows" size="small" border>
        <el-table-column label="姓名" min-width="90" fixed>
          <template #default="{ row }"><span class="link" @click="open(row)">{{ row.employee.name }}</span></template>
        </el-table-column>
        <el-table-column label="工号" min-width="80"><template #default="{ row }">{{ row.employee.jobNumber }}</template></el-table-column>
        <el-table-column label="部门" min-width="160"><template #default="{ row }">{{ row.employee.deptPath }}</template></el-table-column>
        <el-table-column v-for="c in COLS" :key="c.k" :label="c.label" :prop="c.k" min-width="70" align="right">
          <template #default="{ row }"><span :class="{ bad: c.bad && row[c.k] }">{{ row[c.k] }}</span></template>
        </el-table-column>
        <el-table-column v-for="t in types" :key="t.code" :label="t.name" min-width="64" align="right">
          <template #default="{ row }">{{ row.leaveByType[t.code] || '' }}</template>
        </el-table-column>
      </el-table>
    </div>
    <p class="help">迟到、早退、缺卡、旷工按天数计；请假按工作日天数计。「无记录」是工作日既没有打卡记录也没有请假（可能没排班或没同步到）。</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'
import { thisMonth } from '../labels.js'

const COLS = [
  { k: 'workdays', label: '应出勤' }, { k: 'normal', label: '正常' }, { k: 'abnormal', label: '异常', bad: true },
  { k: 'late', label: '迟到', bad: true }, { k: 'early', label: '早退', bad: true }, { k: 'missing', label: '缺卡', bad: true },
  { k: 'absent', label: '旷工', bad: true }, { k: 'location', label: '地点异常', bad: true }, { k: 'noData', label: '无记录' }, { k: 'leaveDays', label: '请假' }
]
const router = useRouter()
const month = ref(thisMonth())
const keyword = ref('')
const rows = ref([])
const types = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try { rows.value = (await api.get('attendance/report', { month: month.value, keyword: keyword.value })).rows } finally { loading.value = false }
}
onMounted(async () => { types.value = await api.get('leave/types', { all: 1 }); load() })
const open = (row) => router.push({ path: '/my', query: { userId: row.employee.id, month: month.value } })
const exportCsv = () => window.open(api.url('attendance/report.csv', { month: month.value, keyword: keyword.value }), '_blank')
</script>

<style scoped>
.bad { color: var(--hr-danger); font-weight: 600; }
</style>
