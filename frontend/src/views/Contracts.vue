<template>
  <div class="page">
    <div class="page-head">
      <h2>合同与协议</h2>
      <div class="toolbar">
        <el-input v-model="q.keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 170px" @change="load" />
        <el-select v-model="q.kind" clearable placeholder="全部类型" style="width: 150px" @change="load">
          <el-option v-for="(l, k) in CONTRACT_KINDS" :key="k" :value="k" :label="l" />
        </el-select>
        <el-button v-if="data.canEdit" type="primary" @click="openNew">新建合同</el-button>
      </div>
    </div>

    <el-alert v-if="data.canEdit && !data.storage" type="info" :closable="false" style="margin-bottom: 12px"
      title="平台还没启用文件存储：合同信息照常录，签好的扫描件要等平台管理员在以虎 One「管理 → 系统设置 → 文件存储」配好后才能上传" />

    <el-radio-group v-model="tab" style="margin-bottom: 12px" @change="load">
      <el-radio-button value="">全部</el-radio-button>
      <el-radio-button value="EXPIRING">即将到期 {{ data.counts?.EXPIRING || 0 }}</el-radio-button>
      <el-radio-button value="EXPIRED">已到期 {{ data.counts?.EXPIRED || 0 }}</el-radio-button>
      <el-radio-button value="IN_FORCE">竞业履行中 {{ data.counts?.IN_FORCE || 0 }}</el-radio-button>
      <el-radio-button value="TERMINATED">已解除</el-radio-button>
      <el-radio-button v-if="data.canEdit" value="MISSING">缺劳动合同</el-radio-button>
    </el-radio-group>

    <div class="card table-wrap" v-loading="loading">
      <el-table v-if="tab !== 'MISSING'" :data="data.rows" size="small">
        <el-table-column label="员工" min-width="90" fixed>
          <template #default="{ row }"><router-link :to="`/people/${row.userId}`">{{ row.employee?.name }}</router-link></template>
        </el-table-column>
        <el-table-column label="部门" min-width="140"><template #default="{ row }">{{ row.employee?.deptPath }}</template></el-table-column>
        <el-table-column label="类型" min-width="110"><template #default="{ row }">{{ row.kindLabel }}{{ row.title ? ` · ${row.title}` : '' }}</template></el-table-column>
        <el-table-column label="期限" min-width="190">
          <template #default="{ row }">
            <template v-if="row.kind === 'NON_COMPETE'">离职后 {{ row.restrictMonths }} 个月 · {{ yuan(row.monthlyComp) }}/月<div v-if="row.restrictWindow" class="muted small">{{ row.restrictWindow.from }} ~ {{ row.restrictWindow.to }}</div></template>
            <template v-else>{{ row.startDate }} ~ {{ row.endDate || '无固定期限' }}<div v-if="row.probationEnd" class="muted small">试用期至 {{ row.probationEnd }}</div></template>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="CONTRACT_STATUS[row.status]">{{ row.statusLabel }}</el-tag>
            <div v-if="row.status === 'EXPIRING'" class="small warnc">还有 {{ row.daysLeft }} 天</div>
            <div v-if="row.renewed" class="muted small">已续签</div>
          </template>
        </el-table-column>
        <el-table-column label="编号" prop="number" min-width="100" />
        <el-table-column label="" width="190" fixed="right">
          <template #default="{ row }">
            <a v-if="row.hasFile" :href="`api/contracts/${row.id}/file`" target="_blank" style="margin-right: 10px">文件</a>
            <template v-if="data.canEdit">
              <el-button link type="primary" @click="edit(row)">修改</el-button>
              <el-button v-if="row.kind === 'LABOR' && !row.renewed && ['ACTIVE', 'EXPIRING', 'EXPIRED'].includes(row.status)" link type="primary" @click="renew(row)">续签</el-button>
              <el-dropdown trigger="click" @command="(cmd) => more(cmd, row)">
                <el-button link type="primary" style="margin-left: 8px">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="!row.terminatedAt" command="terminate">解除 / 终止</el-dropdown-item>
                    <el-dropdown-item command="remove">删除（录错了）</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <template v-else>
        <p class="help">这些在职的人没有有效的劳动合同（没录、已到期或已解除）。未签书面劳动合同超过一个月，用人单位要支付双倍工资（劳动合同法第八十二条）。</p>
        <el-table :data="missing" size="small">
          <el-table-column label="员工" min-width="100"><template #default="{ row }"><router-link :to="`/people/${row.id}`">{{ row.name }}</router-link></template></el-table-column>
          <el-table-column label="工号" prop="jobNumber" min-width="90" />
          <el-table-column label="部门" prop="deptPath" min-width="180" />
          <el-table-column label="" width="110"><template #default="{ row }"><el-button link type="primary" @click="openNew(row)">录劳动合同</el-button></template></el-table-column>
        </el-table>
      </template>
    </div>
    <p class="help">到期前 {{ data.warnDays }} 天提醒（「设置 → 规则」里改）。劳动合同期满前要和员工确认续签与否；人事在 AI 助手和老板简报里也会收到提醒。</p>

    <ContractDialog v-model="dlg.open" :contract="dlg.contract" :renew-of="dlg.renewOf" :employee="dlg.employee" @saved="load" />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { CONTRACT_KINDS, CONTRACT_STATUS, today, yuan } from '../labels.js'
import ContractDialog from '../components/ContractDialog.vue'

const route = useRoute()
const q = reactive({ keyword: '', kind: '' })
const tab = ref(route.query.status || '')
const data = ref({ rows: [], counts: {} })
const missing = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    if (tab.value === 'MISSING') missing.value = (await api.get('contracts', { missing: 'LABOR', keyword: q.keyword })).missing
    else data.value = await api.get('contracts', { ...q, status: tab.value })
  } finally { loading.value = false }
}
onMounted(async () => {
  if (tab.value === 'MISSING') data.value = await api.get('contracts', { status: 'NONE' })
  load()
})

const dlg = reactive({ open: false, contract: null, renewOf: null, employee: null })
const openNew = (emp) => Object.assign(dlg, { open: true, contract: null, renewOf: null, employee: emp?.id ? emp : null })
const edit = (c) => Object.assign(dlg, { open: true, contract: c, renewOf: null, employee: c.employee })
const renew = (c) => Object.assign(dlg, { open: true, contract: null, renewOf: c, employee: c.employee })

async function more(cmd, row) {
  if (cmd === 'terminate') {
    const { value } = await ElMessageBox.prompt(`${row.employee?.name} 的${row.kindLabel}：解除日期（YYYY-MM-DD）和原因用空格分开`, '解除 / 终止', { inputValue: `${today()} `, confirmButtonText: '解除', cancelButtonText: '取消' })
    const [date, ...reason] = String(value || '').trim().split(/\s+/)
    await api.post(`contracts/${row.id}/terminate`, { date, reason: reason.join(' ') })
    ElMessage.success('已解除')
  } else if (cmd === 'remove') {
    await ElMessageBox.confirm(`删除 ${row.employee?.name} 的这份${row.kindLabel}？只用于录错的情况；到期、解除的合同不要删，留着备查。`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await api.del(`contracts/${row.id}`)
    ElMessage.success('已删除')
  }
  load()
}
</script>

<style scoped>
.warnc { color: var(--hr-warn); }
</style>
