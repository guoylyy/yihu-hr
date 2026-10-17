<template>
  <div class="page">
    <div class="page-head">
      <h2>人员全景<span class="muted small" style="margin-left: 8px; font-weight: normal">{{ data?.isHr ? '全公司' : '本部门' }} · {{ data?.today }}</span></h2>
      <div class="toolbar">
        <el-input v-model="q.keyword" placeholder="姓名 / 工号 / 部门 / 职级" clearable style="width: 190px" @change="load" />
        <el-select v-model="q.flag" clearable placeholder="按标记筛" style="width: 190px" @change="load">
          <el-option v-for="(l, k) in PEOPLE_FLAGS" :key="k" :value="k" :label="l" />
        </el-select>
      </div>
    </div>

    <div v-if="data" v-loading="loading">
      <div class="tiles">
        <div class="tile"><div class="v">{{ t.headcount }}</div><div class="k">在职人数</div></div>
        <div class="tile"><div class="v">{{ t.joinedThisYear }} / {{ t.leftThisYear }}</div><div class="k">今年入职 / 离职</div></div>
        <div class="tile"><div class="v">{{ t.avgTenure ?? '—' }}<span class="unit">年</span></div><div class="k">平均司龄</div></div>
        <div class="tile"><div class="v">{{ t.avgAge ?? '—' }}<span class="unit">岁</span></div><div class="k">平均年龄</div></div>
        <div class="tile" :class="{ bad: t.risk }" @click="filter('ANY')"><div class="v">{{ t.risk }}</div><div class="k">有风险的人</div></div>
        <template v-if="data.seeContracts">
          <div class="tile" :class="{ bad: t.noLabor }" @click="filter('NO_LABOR')"><div class="v">{{ t.noLabor }}</div><div class="k">没有有效劳动合同</div></div>
          <div class="tile" :class="{ warn: t.contractsExpiring }" @click="filter('LABOR_EXPIRING')"><div class="v">{{ t.contractsExpiring }}</div><div class="k">合同即将到期</div></div>
          <div class="tile" :class="{ warn: t.probationEnding }" @click="filter('PROBATION_ENDING')"><div class="v">{{ t.probationEnding }}</div><div class="k">试用期快结束</div></div>
        </template>
        <div class="tile" :class="t.oneOnOneCoverage >= 80 ? 'good' : 'warn'" @click="filter('NO_1V1')"><div class="v">{{ t.oneOnOneCoverage ?? '—' }}<span class="unit">%</span></div><div class="k">1v1 覆盖（{{ data.cadence }} 天内）</div></div>
        <div class="tile" :class="{ warn: t.lowMood }" @click="filter('LOW_MOOD')"><div class="v">{{ t.lowMood }}</div><div class="k">状态偏低</div></div>
        <template v-if="data.seeCost">
          <div class="tile"><div class="v">{{ wan(t.costYtd) }}</div><div class="k">今年人员成本</div></div>
          <div class="tile"><div class="v">{{ wan(t.costPerHead) }}</div><div class="k">人均（今年）</div></div>
        </template>
      </div>

      <div class="grid">
        <div class="card">
          <h3>按部门</h3>
          <div class="table-wrap">
            <el-table :data="data.byDept" size="small" @row-click="(r) => { q.dept = r.dept; load() }">
              <el-table-column label="部门" prop="dept" min-width="150" />
              <el-table-column label="人数" prop="headcount" width="60" align="right" />
              <el-table-column label="平均司龄" width="80" align="right"><template #default="{ row }">{{ row.avgTenure ?? '—' }}</template></el-table-column>
              <el-table-column label="风险 / 提醒" width="90" align="center">
                <template #default="{ row }"><span :class="{ bad: row.risk }">{{ row.risk }}</span> / <span :class="{ warnc: row.warn }">{{ row.warn }}</span></template>
              </el-table-column>
              <el-table-column label="1v1 覆盖" width="80" align="right"><template #default="{ row }">{{ row.oneOnOneCoverage }}%</template></el-table-column>
              <el-table-column v-if="data.seeCost" label="今年成本" width="100" align="right"><template #default="{ row }">{{ wan(row.costYtd) }}</template></el-table-column>
              <el-table-column v-if="data.seeCost" label="人均" width="90" align="right"><template #default="{ row }">{{ wan(row.costPerHead) }}</template></el-table-column>
            </el-table>
          </div>
        </div>
        <div class="card">
          <h3>结构</h3>
          <el-tabs v-model="distTab">
            <el-tab-pane label="司龄" name="tenure" />
            <el-tab-pane label="年龄" name="age" />
            <el-tab-pane label="学历" name="education" />
            <el-tab-pane label="用工" name="employment" />
            <el-tab-pane v-if="data.seeCost" label="成本构成" name="cost" />
          </el-tabs>
          <Bars v-if="distTab === 'cost'" :rows="costRows" :format="wan" />
          <Bars v-else :rows="(data.distributions[distTab] || []).map(d => ({ key: d.key, value: d.count }))" />
        </div>
      </div>

      <div class="card">
        <div class="toolbar" style="justify-content: space-between; margin-bottom: 8px">
          <h3 style="margin: 0">人员（{{ data.people.length }}）<span v-if="q.dept" class="muted small"> · {{ q.dept }} <span class="link" @click="q.dept = ''; load()">清除</span></span><span v-if="q.flag" class="muted small"> · {{ PEOPLE_FLAGS[q.flag] }}</span></h3>
        </div>
        <div class="table-wrap">
          <el-table :data="data.people" size="small" @row-click="(r) => router.push(`/people/${r.employee.id}`)" row-class-name="clickable">
            <el-table-column label="姓名" min-width="90" fixed><template #default="{ row }"><b>{{ row.employee.name }}</b></template></el-table-column>
            <el-table-column label="部门" prop="dept" min-width="150" />
            <el-table-column label="职级" prop="level" width="70" />
            <el-table-column label="司龄" width="70" align="right"><template #default="{ row }">{{ row.tenure ?? '—' }}</template></el-table-column>
            <el-table-column label="上次 1v1" width="100"><template #default="{ row }">{{ row.last1v1 || '—' }}</template></el-table-column>
            <el-table-column v-if="data.seeCost" label="今年成本" width="100" align="right"><template #default="{ row }">{{ wan(row.costYtd) }}</template></el-table-column>
            <el-table-column label="要留意" min-width="280">
              <template #default="{ row }">
                <el-tag v-for="f in row.flags" :key="f.code + f.text" size="small" :type="FLAG_LEVEL[f.level]" style="margin: 0 4px 2px 0">{{ f.text }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'
import { COST_CATEGORIES, FLAG_LEVEL, PEOPLE_FLAGS, wan } from '../labels.js'
import Bars from '../components/Bars.vue'

const router = useRouter()
const q = reactive({ keyword: '', flag: '', dept: '' })
const data = ref(null)
const loading = ref(false)
const distTab = ref('tenure')
const t = computed(() => data.value?.tiles || {})
const costRows = computed(() => Object.entries(data.value?.cost?.byCategory || {}).map(([k, v]) => ({ key: COST_CATEGORIES[k] || k, value: v })).sort((a, b) => b.value - a.value))

async function load() {
  loading.value = true
  try { data.value = await api.get('people/overview', q) } finally { loading.value = false }
}
function filter(flag) { q.flag = q.flag === flag ? '' : flag; load() }
onMounted(load)
</script>

<style scoped>
.grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; }
.tile { cursor: default; }
.tile[class*='bad'], .tile[class*='warn'], .tile[class*='good'] { cursor: pointer; }
.unit { font-size: 13px; font-weight: normal; margin-left: 2px; color: var(--hr-muted); }
.bad { color: var(--hr-danger); font-weight: 600; }
.warnc { color: var(--hr-warn); font-weight: 600; }
:deep(.clickable) { cursor: pointer; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
