<template>
  <div v-loading="loading" class="card">
    <el-form v-if="schema.length" label-width="200px" label-position="left" class="rules" @submit.prevent>
      <el-form-item v-for="f in schema" :key="f.key" :label="f.label">
        <div class="field">
          <el-switch v-if="f.type === 'boolean'" v-model="values[f.key]" />
          <el-input-number v-else-if="f.type === 'number'" v-model="values[f.key]" :min="f.min" :max="f.max" />
          <el-select v-else-if="f.type === 'select'" v-model="values[f.key]" style="width: 240px">
            <el-option v-for="o in f.options" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
          <el-checkbox-group v-else-if="f.type === 'weekdays'" v-model="values[f.key]">
            <el-checkbox v-for="d in [1, 2, 3, 4, 5, 6, 0]" :key="d" :value="d">周{{ WEEK[d] }}</el-checkbox>
          </el-checkbox-group>
          <el-input v-else v-model="values[f.key]" style="width: 240px" />
          <div v-if="f.help" class="help">{{ f.help }}</div>
        </div>
      </el-form-item>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </el-form>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api.js'
import { WEEK } from '../../labels.js'

const schema = ref([])
const values = ref({})
const loading = ref(false)
const saving = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const r = await api.get('settings')
    schema.value = r.schema
    values.value = { ...r.values }
  } finally { loading.value = false }
})

async function save() {
  saving.value = true
  try {
    values.value = { ...(await api.patch('settings', values.value)) }
    ElMessage.success('已保存')
  } finally { saving.value = false }
}
</script>

<style scoped>
.field { display: flex; flex-direction: column; align-items: flex-start; }
.field .help { margin-bottom: 0; }
@media (max-width: 760px) {
  .rules :deep(.el-form-item) { flex-direction: column; align-items: flex-start; }
  .rules :deep(.el-form-item__label) { width: auto !important; }
}
</style>
