<template>
  <div class="bars">
    <div v-for="r in rows" :key="r.key" class="row">
      <span class="k" :title="r.key">{{ r.key }}</span>
      <span class="track"><span class="fill" :style="{ width: pct(r.value) }" /></span>
      <span class="v">{{ format ? format(r.value) : r.value }}</span>
    </div>
    <div v-if="!rows.length" class="muted small">暂无数据</div>
  </div>
</template>

<script setup>
// 横向条形：[{ key, value }]
const props = defineProps({ rows: { type: Array, default: () => [] }, format: Function })
const pct = (v) => {
  const max = Math.max(...props.rows.map(r => r.value), 0)
  return max ? `${Math.max(2, Math.round(v / max * 100))}%` : '0%'
}
</script>

<style scoped>
.bars { display: flex; flex-direction: column; gap: 6px; }
.row { display: grid; grid-template-columns: minmax(70px, 30%) 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
.k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--hr-muted); }
.track { height: 8px; background: var(--hr-bg); border-radius: 4px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--hr-primary); border-radius: 4px; }
.v { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
