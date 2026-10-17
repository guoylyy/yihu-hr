<template>
  <el-select :model-value="modelValue" filterable remote clearable :remote-method="search" :loading="loading"
    :placeholder="placeholder" style="width: 100%" @update:model-value="$emit('update:modelValue', $event)">
    <el-option v-for="e in options" :key="e.id" :value="e.id" :label="e.name">
      <span>{{ e.name }}</span><span class="muted small" style="margin-left: 8px">{{ e.jobNumber || '' }} {{ e.deptPath || '' }}</span>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '../api.js'

const props = defineProps({ modelValue: [Number, null], initial: Object, placeholder: { type: String, default: '输入姓名、工号或部门搜索' } })
defineEmits(['update:modelValue'])
const options = ref([])
const loading = ref(false)
watch(() => props.initial, (v) => { if (v?.id && !options.value.some(o => o.id === v.id)) options.value = [v, ...options.value] }, { immediate: true })

async function search(keyword) {
  loading.value = true
  try { options.value = await api.get('employees/search', { keyword }) } finally { loading.value = false }
}
</script>
