<template>
  <div class="page">
    <div class="page-head">
      <h2>团队考勤</h2>
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 180px" @change="load" />
        <el-date-picker v-model="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 150px" @change="load" />
      </div>
    </div>

    <div v-if="data" class="tiles">
      <div class="tile"><div class="v">{{ data.stats.total }}</div><div class="k">人数</div></div>
      <div class="tile good"><div class="v">{{ data.stats.normal }}</div><div class="k">正常</div></div>
      <div class="tile" :class="{ bad: data.stats.abnormal }"><div class="v">{{ data.stats.abnormal }}</div><div class="k">异常</div></div>
      <div class="tile"><div class="v">{{ data.stats.leave }}</div><div class="k">请假</div></div>
      <div class="tile" :class="{ warn: data.stats.noData }"><div class="v">{{ data.stats.noData }}</div><div class="k">无记录</div></div>
    </div>
    <p v-if="data && !data.workday" class="help">{{ data.date }} 不是工作日。</p>

    <div class="card table-wrap">
      <el-table v-loading="loading" :data="data?.rows || []" size="small">
        <el-table-column label="员工" min-width="90">
          <template #default="{ row }"><span class="link" @click="open(row)">{{ row.employee.name }}</span></template>
        </el-table-column>
        <el-table-column label="部门" min-width="160"><template #default="{ row }">{{ row.employee.deptPath }}</template></el-table-column>
        <el-table-column label="状态" min-width="160"><template #default="{ row }"><StatusTag :status="row.status" :flags="row.flags" /></template></el-table-column>
        <el-table-column label="上班" prop="firstIn" min-width="70" />
        <el-table-column label="下班" prop="lastOut" min-width="70" />
        <el-table-column label="来源" min-width="100">
          <template #default="{ row }">{{ [...new Set(row.records.map(r => r.sourceLabel))].join('、') }}</template>
        </el-table-column>
        <el-table-column v-if="me.hr" label="" width="70" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openPatch(row)">补录</el-button></template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="patch.open" :title="`补录打卡 · ${patch.name} · ${date}`" width="min(440px, 94vw)">
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
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { me } from '../me.js'
import { today } from '../labels.js'
import StatusTag from '../components/StatusTag.vue'

const router = useRouter()
const date = ref(today())
const keyword = ref('')
const data = ref(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try { data.value = await api.get('attendance/team', { date: date.value, keyword: keyword.value }) } finally { loading.value = false }
}
onMounted(load)

const open = (row) => router.push({ path: '/my', query: { userId: row.employee.id, month: date.value.slice(0, 7) } })

const patch = reactive({ open: false, saving: false, name: '', form: {} })
function openPatch(row) {
  patch.name = row.employee.name
  patch.form = { userId: row.employee.id, kind: row.firstIn ? 'OUT' : 'IN', time: row.firstIn ? '18:00' : '09:00', note: '' }
  patch.open = true
}
async function savePatch() {
  patch.saving = true
  try {
    await api.post('attendance/punches', { ...patch.form, date: date.value })
    ElMessage.success('已补录')
    patch.open = false
    load()
  } finally { patch.saving = false }
}
</script>
