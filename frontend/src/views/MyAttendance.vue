<template>
  <div class="page">
    <div class="page-head">
      <h2>{{ data && data.employee && data.employee.id !== me.user?.id ? `${data.employee.name}的考勤` : '我的考勤' }}</h2>
      <div class="toolbar">
        <el-button v-if="userId" text @click="$router.push({ path: '/my', query: { month } })">看我自己的</el-button>
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 140px" @change="load" />
      </div>
    </div>

    <div v-if="data" class="tiles">
      <div class="tile"><div class="v">{{ s.workdays }}</div><div class="k">应出勤（天）</div></div>
      <div class="tile good"><div class="v">{{ s.normal }}</div><div class="k">正常</div></div>
      <div class="tile" :class="{ bad: s.late }"><div class="v">{{ s.late }}</div><div class="k">迟到</div></div>
      <div class="tile" :class="{ bad: s.early }"><div class="v">{{ s.early }}</div><div class="k">早退</div></div>
      <div class="tile" :class="{ bad: s.missing }"><div class="v">{{ s.missing }}</div><div class="k">缺卡</div></div>
      <div class="tile" :class="{ bad: s.absent }"><div class="v">{{ s.absent }}</div><div class="k">旷工</div></div>
      <div class="tile"><div class="v">{{ s.leaveDays }}</div><div class="k">请假（天）</div></div>
      <div class="tile" :class="{ warn: s.noData }"><div class="v">{{ s.noData }}</div><div class="k">无记录</div></div>
    </div>

    <div class="card table-wrap">
      <el-table v-loading="loading" :data="data?.days || []" row-key="date" size="small" :row-class-name="rowClass">
        <el-table-column type="expand" width="36">
          <template #default="{ row }">
            <div class="records">
              <div v-if="!row.records.length" class="muted">这天没有打卡记录</div>
              <div v-for="r in row.records" :key="r.id" class="rec">
                <el-tag size="small" type="info" disable-transitions>{{ r.sourceLabel }}</el-tag>
                <span>{{ KIND[r.kind] || r.kind }}</span>
                <b>{{ r.time || '未打卡' }}</b>
                <span v-if="r.planTime" class="muted">应 {{ r.planTime }}</span>
                <span :class="r.result === 'NORMAL' ? 'muted' : 'bad'">{{ FLAG[r.result] || r.result }}</span>
                <span v-if="r.location" class="muted">{{ r.location }}</span>
                <span v-if="r.note" class="muted">{{ r.note }}</span>
              </div>
              <div v-for="l in row.leaveTypes" :key="l.requestId" class="rec muted">请假：{{ typeName(l.code) }} {{ l.units }} 天</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="日期" min-width="110">
          <template #default="{ row }">{{ row.date.slice(5) }} 周{{ weekdayOf(row.date) }}<span v-if="!row.workday" class="muted small">（休）</span></template>
        </el-table-column>
        <el-table-column label="状态" min-width="160"><template #default="{ row }"><StatusTag :status="row.status" :flags="row.flags" /></template></el-table-column>
        <el-table-column label="上班" prop="firstIn" min-width="70" />
        <el-table-column label="下班" prop="lastOut" min-width="70" />
        <el-table-column label="请假" min-width="90">
          <template #default="{ row }">{{ row.leaveTypes.map(l => `${typeName(l.code)} ${l.units}`).join('、') }}</template>
        </el-table-column>
      </el-table>
    </div>
    <p class="help">考勤以钉钉 / 飞书 / 企业微信的打卡结果为准，定时同步；在这里批准的请假会覆盖当天的缺卡、旷工。有出入请找人事补录。</p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.js'
import { me } from '../me.js'
import { FLAG, KIND, thisMonth, weekdayOf } from '../labels.js'
import StatusTag from '../components/StatusTag.vue'

const route = useRoute()
const month = ref(route.query.month || thisMonth())
const userId = computed(() => route.query.userId)
const data = ref(null)
const loading = ref(false)
const types = ref([])
const s = computed(() => data.value?.summary || {})
const typeName = (c) => types.value.find(t => t.code === c)?.name || c
const rowClass = ({ row }) => (row.workday ? '' : 'rest-row')

async function load() {
  loading.value = true
  try { data.value = await api.get('attendance/month', { month: month.value, userId: userId.value }) } finally { loading.value = false }
}
watch(() => route.query, (q) => { if (q.month) month.value = q.month; load() })
onMounted(async () => { load(); types.value = await api.get('leave/types', { all: 1 }) })
</script>

<style scoped>
.records { padding: 4px 16px 8px 48px; display: flex; flex-direction: column; gap: 6px; }
.rec { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.bad { color: var(--hr-danger); }
:deep(.rest-row) { color: var(--hr-muted); }
</style>
