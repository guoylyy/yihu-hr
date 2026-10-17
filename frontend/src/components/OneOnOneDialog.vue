<template>
  <el-dialog :model-value="modelValue" :title="form.id ? '修改 1v1 记录' : `记一次 1v1${employee ? ' · ' + employee.name : ''}`" width="min(640px, 96vw)" @update:model-value="$emit('update:modelValue', $event)">
    <el-form label-width="76px" @submit.prevent>
      <el-form-item v-if="!form.id && !employee" label="和谁"><EmployeePicker v-model="form.userId" placeholder="选一位下属" /></el-form-item>
      <el-form-item label="日期">
        <el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 160px" />
        <el-input-number v-model="form.minutes" :min="5" :max="600" :step="5" controls-position="right" style="width: 120px; margin-left: 8px" /><span class="muted small" style="margin-left: 6px">分钟</span>
      </el-form-item>
      <el-form-item label="状态">
        <el-rate v-model="form.mood" :texts="Object.values(MOODS)" show-text clearable />
        <span class="muted small" style="margin-left: 8px">对方最近的状态，本人看不到</span>
      </el-form-item>
      <el-form-item label="话题">
        <el-check-tag v-for="t in TOPICS" :key="t" :checked="form.topics.includes(t)" style="margin: 0 6px 6px 0" @change="toggleTopic(t)">{{ t }}</el-check-tag>
      </el-form-item>
      <el-form-item label="纪要"><el-input v-model="form.notes" type="textarea" :rows="5" placeholder="聊了什么、达成了什么共识" /></el-form-item>
      <el-form-item label="待办">
        <div style="width: 100%">
          <div v-for="(a, i) in form.actions" :key="i" class="action-row">
            <el-checkbox v-model="a.done" />
            <el-input v-model="a.text" placeholder="要做的事" />
            <el-select v-model="a.owner" style="width: 96px"><el-option value="EMPLOYEE" label="本人" /><el-option value="MANAGER" label="负责人" /></el-select>
            <el-date-picker v-model="a.due" value-format="YYYY-MM-DD" placeholder="期限" style="width: 140px" />
            <el-button link type="danger" @click="form.actions.splice(i, 1)">删</el-button>
          </div>
          <el-button link type="primary" @click="form.actions.push({ text: '', owner: 'EMPLOYEE', due: null, done: false })">+ 加一项待办</el-button>
        </div>
      </el-form-item>
      <el-form-item label="下次"><el-date-picker v-model="form.nextDate" value-format="YYYY-MM-DD" placeholder="约下次 1v1" style="width: 160px" /></el-form-item>
      <el-form-item label="私人备注"><el-input v-model="form.privateNote" type="textarea" :rows="2" placeholder="只有你和人事能看到（不给本人看）" /></el-form-item>
      <el-form-item label="">
        <el-checkbox v-model="form.shared">纪要和待办给本人看</el-checkbox>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { MOODS, TOPICS, today } from '../labels.js'
import EmployeePicker from './EmployeePicker.vue'

const props = defineProps({ modelValue: Boolean, record: Object, employee: Object })
const emit = defineEmits(['update:modelValue', 'saved'])
const form = ref({ topics: [], actions: [] })
const saving = ref(false)

watch(() => props.modelValue, (open) => {
  if (!open) return
  const r = props.record
  form.value = r
    ? { id: r.id, userId: r.userId, date: r.date, minutes: r.minutes, mood: r.mood || 0, topics: [...(r.topics || [])], notes: r.notes || '', privateNote: r.privateNote || '', actions: r.actions.map(a => ({ text: a.text, owner: a.owner, due: a.due, done: a.done })), nextDate: r.nextDate, shared: r.shared }
    : { userId: props.employee?.id ?? null, date: today(), minutes: 30, mood: 0, topics: [], notes: '', privateNote: '', actions: [], nextDate: null, shared: true }
})

function toggleTopic(t) {
  const i = form.value.topics.indexOf(t)
  i >= 0 ? form.value.topics.splice(i, 1) : form.value.topics.push(t)
}

async function save() {
  if (!form.value.userId) return ElMessage.warning('选一位同事')
  saving.value = true
  try {
    const r = await api.post('one-on-ones', { ...form.value, mood: form.value.mood || null, actions: form.value.actions.filter(a => a.text.trim()) })
    ElMessage.success('已保存')
    emit('update:modelValue', false)
    emit('saved', r)
  } finally { saving.value = false }
}
</script>

<style scoped>
.action-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.action-row .el-input { flex: 1; min-width: 160px; }
</style>
