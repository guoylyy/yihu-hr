<template>
  <div class="page">
    <div class="page-head">
      <h2>我的假期</h2>
      <div class="toolbar">
        <el-radio-group v-model="category" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="LEAVE">请假</el-radio-button>
          <el-radio-button value="TRIP">出差</el-radio-button>
          <el-radio-button value="OUT">外出</el-radio-button>
        </el-radio-group>
        <el-date-picker v-model="yearStr" type="year" value-format="YYYY" :clearable="false" style="width: 110px" @change="load" />
      </div>
    </div>

    <div class="tiles balances">
      <div v-for="b in balance.items" :key="b.code" class="tile link-tile" @click="openLedger(b)">
        <div class="v">{{ days(b.available) }}<span class="unit">天</span></div>
        <div class="k">{{ balance.year }} 年{{ b.name }}余额</div>
      </div>
      <div v-for="(d, k) in used" :key="k" class="tile">
        <div class="v">{{ days(d) }}<span class="unit">天</span></div>
        <div class="k">{{ year }} 年已休{{ k }}</div>
      </div>
    </div>

    <div class="card">
      <h3>请假、出差、外出记录</h3>
      <div class="table-wrap">
        <el-table v-loading="loading" :data="list" size="small">
          <el-table-column label="类别" min-width="60"><template #default="{ row }">{{ row.categoryLabel }}</template></el-table-column>
          <el-table-column label="类型" min-width="80"><template #default="{ row }">{{ row.typeName || '—' }}</template></el-table-column>
          <el-table-column label="时间" min-width="230"><template #default="{ row }">{{ span(row) }}</template></el-table-column>
          <el-table-column label="时长" min-width="80"><template #default="{ row }">{{ row.reportedDays != null ? days(row.reportedDays) + ' 天' : row.hours != null ? row.hours + ' 小时' : '' }}</template></el-table-column>
          <el-table-column label="计入工作日" min-width="90"><template #default="{ row }">{{ days(row.workDays) }} 天</template></el-table-column>
          <el-table-column label="来源" prop="sourceLabel" min-width="80" />
        </el-table>
      </div>
      <p class="help">请假、出差、外出在{{ sourceNames }}里提交和审批，审批通过后自动同步过来（每 30 分钟左右）。年假、调休这类扣余额的假，同步过来时自动从余额里扣，撤销了自动退回。</p>
    </div>

    <el-drawer v-model="ledger.open" :title="`${ledger.title} · 余额明细`" size="min(520px, 100vw)">
      <el-table :data="ledger.rows" size="small">
        <el-table-column label="时间" min-width="140"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="类型" min-width="80"><template #default="{ row }">{{ LEDGER_KIND[row.kind] || row.kind }}</template></el-table-column>
        <el-table-column label="天数" min-width="60"><template #default="{ row }">{{ row.delta > 0 ? '+' : '' }}{{ days(row.delta) }}</template></el-table-column>
        <el-table-column label="说明" prop="note" min-width="160" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../api.js'
import { me } from '../me.js'
import { LEDGER_KIND, days, fmtTime, span, thisYear } from '../labels.js'

const yearStr = ref(String(thisYear()))
const year = computed(() => Number(yearStr.value))
const category = ref('')
const balance = ref({ items: [] })
const list = ref([])
const loading = ref(false)
const sourceNames = computed(() => me.sources?.map(s => s.label).join(' / ') || '钉钉 / 飞书 / 企业微信')
// 今年各类请假用了多少（按记录的工作日天数，只算落在这一年的）
const used = computed(() => {
  const out = {}
  for (const a of list.value) if (a.category === 'LEAVE') out[a.typeName || '请假'] = (out[a.typeName || '请假'] || 0) + a.workDays
  return out
})

async function load() {
  loading.value = true
  try {
    ;[balance.value, list.value] = await Promise.all([
      api.get('balance/mine', { year: year.value }),
      api.get('absences', { from: `${year.value}-01-01`, to: `${year.value}-12-31`, category: category.value })
    ])
  } finally { loading.value = false }
}
onMounted(load)

const ledger = reactive({ open: false, title: '', rows: [] })
async function openLedger(b) {
  ledger.title = `${balance.value.year} 年${b.name}`
  ledger.rows = await api.get('balance/ledger', { typeCode: b.code, year: balance.value.year })
  ledger.open = true
}
</script>

<style scoped>
.unit { font-size: 13px; font-weight: 400; margin-left: 2px; }
.link-tile { cursor: pointer; }
.link-tile:hover { border-color: var(--hr-primary); }
.balances { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
</style>
