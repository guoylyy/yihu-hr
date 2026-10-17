<template>
  <div>
    <p class="help">人事能看全部员工的考勤、审批任何请假、管理假期余额和设置。平台管理员自动算人事，不用加。</p>
    <div class="toolbar" style="margin-bottom: 12px">
      <div style="width: 260px"><EmployeePicker v-model="pick" /></div>
      <el-button type="primary" :disabled="!pick" @click="add">添加</el-button>
    </div>
    <div class="card table-wrap">
      <el-table v-loading="loading" :data="list" size="small" empty-text="还没有加人事成员">
        <el-table-column label="姓名" prop="name" min-width="90" />
        <el-table-column label="工号" prop="jobNumber" min-width="80" />
        <el-table-column label="部门" prop="deptPath" min-width="160" />
        <el-table-column label="加入时间" min-width="140"><template #default="{ row }">{{ fmtTime(row.addedAt) }}</template></el-table-column>
        <el-table-column label="" width="60" fixed="right"><template #default="{ row }"><el-button link type="danger" @click="remove(row)">移除</el-button></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api.js'
import { fmtTime } from '../../labels.js'
import EmployeePicker from '../../components/EmployeePicker.vue'

const list = ref([])
const loading = ref(false)
const pick = ref(null)
async function load() {
  loading.value = true
  try { list.value = await api.get('hr-members') } finally { loading.value = false }
}
onMounted(load)

async function add() {
  await api.post('hr-members', { userId: pick.value })
  ElMessage.success('已添加')
  pick.value = null
  load()
}
async function remove(row) {
  await ElMessageBox.confirm(`把 ${row.name} 移出人事？`, '移除', { type: 'warning' })
  await api.del(`hr-members/${row.id}`)
  load()
}
</script>
