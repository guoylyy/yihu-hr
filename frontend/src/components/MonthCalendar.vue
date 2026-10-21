<template>
  <div class="cal">
    <div v-for="w in WEEKDAYS" :key="w" class="wd">周{{ WEEK[w] }}</div>
    <div v-for="n in lead" :key="'b' + n" class="cell blank" />
    <button
      v-for="d in days" :key="d.date" type="button"
      class="cell" :class="[`st-${shown(d)}`, { today: d.date === today, picked: d.date === picked, future: d.date > today, rest: !d.workday }]"
      @click="$emit('pick', d)"
    >
      <div class="top">
        <span class="num">{{ Number(d.date.slice(8)) }}</span>
        <span v-if="label(d)" class="badge">{{ label(d) }}</span>
      </div>
      <div v-if="d.firstIn || d.lastOut || hasMissing(d)" class="times">
        <span :class="{ bad: has(d, 'LATE', 'SERIOUS_LATE') || !d.firstIn }">{{ d.firstIn || (hasMissing(d) ? '缺卡' : '--:--') }}</span>
        <span class="sep">–</span>
        <span :class="{ bad: has(d, 'EARLY') || !d.lastOut }">{{ d.lastOut || (hasMissing(d) ? '缺卡' : '--:--') }}</span>
      </div>
      <div class="chips">
        <span v-for="l in d.leaveTypes" :key="'l' + (l.absenceId || l.requestId)" class="chip leave">{{ l.name || '请假' }}{{ l.units < 1 ? ' ' + days2(l.units) + '天' : '' }}</span>
        <span v-for="a in d.away" :key="'a' + a.absenceId" class="chip" :class="a.category === 'TRIP' ? 'trip' : 'out'">{{ a.category === 'TRIP' ? '出差' : (a.name || '外出') }}</span>
        <span v-if="flagText(d)" class="chip bad">{{ flagText(d) }}</span>
      </div>
    </button>
  </div>
</template>

<script setup>
// 月历：一格一天，格子里直接看到状态、上下班时间、请假 / 出差 / 外出、异常。点格子看这天的明细
import { computed } from 'vue'
import { FLAG, WEEK, days as fmtDays } from '../labels.js'

const props = defineProps({ days: { type: Array, required: true }, today: String, picked: String })
defineEmits(['pick'])

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]
// 周一开头：前面空几格
const lead = computed(() => {
  if (!props.days.length) return 0
  const w = new Date(props.days[0].date + 'T00:00:00Z').getUTCDay()
  return (w + 6) % 7
})
const days2 = fmtDays
const has = (d, ...f) => f.some(x => d.flags.includes(x))
const hasMissing = (d) => has(d, 'MISSING')
const shown = (d) => d.status
const LABEL = { NORMAL: '正常', ABNORMAL: '异常', LEAVE: '请假', TRIP: '出差', OUT: '外出', NO_DATA: '无记录', REST: '休' }
const label = (d) => {
  const s = shown(d)
  if (s === 'FUTURE') return ''
  if (s === 'REST') return d.punches ? '' : '休'
  return LABEL[s]
}
// 时间类以外的异常（地点异常、旷工、其他）单独标出来；迟到早退直接把时间标红
const flagText = (d) => d.flags.filter(f => !['LATE', 'SERIOUS_LATE', 'EARLY', 'MISSING'].includes(f)).map(f => FLAG[f] || f).join('、')
</script>

<style scoped>
.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.wd { text-align: center; color: var(--hr-muted); font-size: 12px; padding: 2px 0; }
.cell {
  min-height: 92px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--hr-border); background: var(--hr-surface);
  display: flex; flex-direction: column; gap: 4px; text-align: left; font: inherit; color: inherit; cursor: pointer; min-width: 0;
}
.cell:hover { border-color: var(--hr-primary); }
.cell.blank { visibility: hidden; }
.cell.today { box-shadow: inset 0 0 0 2px var(--hr-primary); }
.cell.picked { border-color: var(--hr-primary); background: var(--hr-primary-soft); }
.cell.rest:not(.picked) { background: var(--hr-bg); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.num { font-weight: 600; font-size: 15px; }
.rest .num, .future .num { color: var(--hr-muted); }
.badge { font-size: 11px; padding: 0 6px; border-radius: 8px; line-height: 18px; white-space: nowrap; background: var(--hr-bg); color: var(--hr-muted); }
.st-NORMAL .badge { background: var(--el-color-success-light-9); color: var(--hr-ok); }
.st-ABNORMAL { border-color: var(--el-color-danger-light-5); }
.st-ABNORMAL .badge { background: var(--el-color-danger-light-9); color: var(--hr-danger); }
.st-LEAVE .badge, .st-TRIP .badge, .st-OUT .badge { background: var(--hr-primary-soft); color: var(--hr-primary); }
.st-NO_DATA .badge { background: var(--el-color-warning-light-9); color: var(--hr-warn); }
.times { font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
.sep { color: var(--hr-muted); margin: 0 3px; }
.bad { color: var(--hr-danger); font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 3px; }
.chip { font-size: 11px; line-height: 17px; padding: 0 5px; border-radius: 4px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip.leave { background: var(--el-color-primary-light-8); color: var(--el-color-primary-dark-2); }
.chip.trip { background: #ede9fe; color: #6d28d9; }
.chip.out { background: #e0f2fe; color: #0369a1; }
.chip.bad { background: var(--el-color-danger-light-9); color: var(--hr-danger); font-weight: normal; }
@media (max-width: 760px) {
  .cal { gap: 3px; }
  .cell { min-height: 64px; padding: 4px; gap: 2px; }
  .num { font-size: 13px; }
  .badge { font-size: 10px; padding: 0 3px; }
  .times { font-size: 10px; }
  .sep { margin: 0 1px; }
  .chip { font-size: 10px; padding: 0 3px; }
}
@media (max-width: 420px) {
  .times { display: none; }
}
</style>
