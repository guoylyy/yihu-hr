<template>
  <span class="st">
    <el-tag :type="(STATUS[status] || {}).type || 'info'" size="small" disable-transitions>{{ (STATUS[status] || {}).label || status }}</el-tag>
    <span v-if="flags?.length" class="flags">{{ flagsText(flags) }}</span>
  </span>
</template>

<script setup>
import { STATUS, flagsText } from '../labels.js'
defineProps({ status: String, flags: Array })
</script>

<style scoped>
.st { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.flags { color: var(--hr-danger); font-size: 12px; }
</style>
