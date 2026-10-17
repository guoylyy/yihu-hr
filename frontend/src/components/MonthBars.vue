<template>
  <div class="months">
    <div v-for="m in months" :key="m.month" class="col" :title="`${m.month}：${format ? format(m.amount) : m.amount}`">
      <span class="bar" :style="{ height: h(m.amount) }" />
      <span class="lbl">{{ Number(m.month.slice(5)) }}月</span>
    </div>
  </div>
</template>

<script setup>
// 竖向月度柱：[{ month: 'YYYY-MM', amount }]
const props = defineProps({ months: { type: Array, default: () => [] }, format: Function })
const h = (v) => {
  const max = Math.max(...props.months.map(m => m.amount), 0)
  return max ? `${Math.max(v ? 3 : 0, Math.round(v / max * 100))}%` : '0'
}
</script>

<style scoped>
.months { display: flex; align-items: flex-end; gap: 6px; height: 120px; padding-top: 6px; }
.col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 0; }
.bar { width: 100%; max-width: 28px; background: var(--hr-primary); border-radius: 4px 4px 0 0; }
.lbl { font-size: 11px; color: var(--hr-muted); margin-top: 4px; }
</style>
