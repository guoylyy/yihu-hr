<template>
  <div class="page">
    <div class="page-head">
      <h2>1v1</h2>
      <div v-if="hasRoster" class="toolbar">
        <el-input v-model="keyword" placeholder="姓名 / 工号 / 部门" clearable style="width: 170px" @change="loadRoster" />
      </div>
    </div>

    <div :class="hasRoster ? 'layout' : ''">
      <div v-if="hasRoster" class="card roster">
        <div class="person" :class="{ on: selected === 'me' }" @click="select('me')">
          <div><b>我自己</b><div class="muted small">我和我的负责人的 1v1</div></div>
        </div>
        <div class="muted small" style="margin: 10px 0 6px">{{ roster.isHr ? '全公司' : '我的下属' }} · 建议每 {{ roster.cadence || '—' }} 天一次</div>
        <div v-for="r in roster.rows" :key="r.employee.id" class="person" :class="{ on: selected === r.employee.id }" @click="select(r.employee.id)">
          <div>
            <b>{{ r.employee.name }}</b><ExemptTag :value="r.employee.exemption === 'FULL' ? 'FULL' : null" />
            <div class="muted small">{{ r.employee.deptPath }}</div>
          </div>
          <div class="right small">
            <el-tag v-if="r.overdue" size="small" type="warning">{{ r.sinceDays == null ? '从没谈过' : `${r.sinceDays} 天没谈` }}</el-tag>
            <span v-else class="muted">{{ r.sinceDays }} 天前</span>
            <div v-if="r.openActions" class="muted">待办 {{ r.openActions }}</div>
          </div>
        </div>
        <div v-if="!roster.rows.length" class="muted small">没有下属</div>
      </div>

      <div class="records">
        <div v-if="list" class="toolbar" style="justify-content: space-between; margin-bottom: 10px">
          <h3 style="margin: 0">
            <template v-if="list.employee && list.employee.id !== me.user?.id"><router-link :to="`/people/${list.employee.id}`">{{ list.employee.name }}</router-link> 的 1v1</template>
            <template v-else>我的 1v1</template>
            <span class="muted small" style="font-weight: normal; margin-left: 6px">{{ list.rows.length }} 次</span>
          </h3>
          <el-button v-if="list.canLog" type="primary" @click="openNew">记一次 1v1</el-button>
        </div>
        <p v-if="list && list.employee?.id === me.user?.id" class="help">负责人和你 1v1 后记下的纪要和待办（负责人标了「本人可见」的）。你能勾掉自己的待办。</p>
        <OneOnOneCard v-for="r in list?.rows || []" :key="r.id" :r="r" @edit="edit" @remove="remove" @changed="loadRoster" />
        <div v-if="list && !list.rows.length" class="card muted">还没有记录</div>
      </div>
    </div>

    <OneOnOneDialog v-model="dlg.open" :record="dlg.record" :employee="list?.employee && list.employee.id !== me.user?.id ? list.employee : null" @saved="refresh" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import ExemptTag from '../components/ExemptTag.vue'
import { me } from '../me.js'
import OneOnOneCard from '../components/OneOnOneCard.vue'
import OneOnOneDialog from '../components/OneOnOneDialog.vue'

const route = useRoute()
const router = useRouter()
const keyword = ref('')
const roster = ref({ rows: [] })
const list = ref(null)
// 选中的人：同事的 id，或 'me'（自己被谈的记录）；员工没有名单，只看自己的
const selected = ref(route.query.user === 'me' ? 'me' : Number(route.query.user) || null)
const hasRoster = computed(() => me.oneOnOne)

async function loadRoster() {
  if (!hasRoster.value) return
  roster.value = await api.get('one-on-ones/roster', { keyword: keyword.value })
}
async function loadList() {
  list.value = await api.get('one-on-ones', selected.value && selected.value !== 'me' ? { userId: selected.value } : {})
}
function select(id) {
  selected.value = id
  router.replace({ query: { user: id } })
  loadList()
}
const refresh = () => { loadList(); loadRoster() }
onMounted(async () => {
  await loadRoster()
  if (!selected.value && roster.value.rows.length) selected.value = roster.value.rows[0].employee.id
  loadList()
})

const dlg = reactive({ open: false, record: null })
const openNew = () => Object.assign(dlg, { open: true, record: null })
const edit = (r) => Object.assign(dlg, { open: true, record: r })
async function remove(r) {
  await ElMessageBox.confirm(`删除 ${r.date} 的这条 1v1 记录？`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  await api.del(`one-on-ones/${r.id}`)
  ElMessage.success('已删除')
  refresh()
}
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; }
.roster { position: sticky; top: 12px; max-height: calc(100vh - 120px); overflow: auto; padding: 10px; }
.person { display: flex; justify-content: space-between; gap: 8px; padding: 8px; border-radius: var(--hr-radius); cursor: pointer; }
.person:hover { background: var(--hr-bg); }
.person.on { background: var(--hr-primary-soft); }
.right { text-align: right; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .roster { position: static; max-height: 260px; }
}
</style>
