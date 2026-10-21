<template>
  <div class="card one">
    <div class="head">
      <div>
        <b>{{ r.date }}</b>
        <span class="muted small" style="margin-left: 8px">{{ r.manager?.name }}{{ r.minutes ? ` · ${r.minutes} 分钟` : '' }}</span>
        <el-tag v-if="r.mood" size="small" :type="r.mood <= 2 ? 'danger' : r.mood >= 4 ? 'success' : 'info'" style="margin-left: 8px">状态 {{ r.mood }} · {{ MOODS[r.mood] }}</el-tag>
        <el-tag v-if="!r.shared" size="small" type="info" style="margin-left: 6px">本人不可见</el-tag>
      </div>
      <div v-if="r.canEdit">
        <el-button link type="primary" @click="$emit('edit', r)">修改</el-button>
        <el-button link type="danger" @click="$emit('remove', r)">删除</el-button>
      </div>
    </div>
    <div v-if="r.topics?.length" style="margin: 6px 0"><el-tag v-for="t in r.topics" :key="t" size="small" effect="plain" style="margin-right: 4px">{{ t }}</el-tag></div>
    <div v-if="r.notes" class="pre">{{ r.notes }}</div>
    <div v-if="r.privateNote" class="private pre"><span class="muted small">私人备注：</span>{{ r.privateNote }}</div>
    <div v-if="r.actions?.length" class="actions">
      <div v-for="a in r.actions" :key="a.index" class="act">
        <el-checkbox :model-value="a.done" :disabled="!canTick(a)" @change="(v) => tick(a, v)">
          <span :class="{ done: a.done }">{{ a.text }}</span>
        </el-checkbox>
        <span class="muted small">{{ a.ownerLabel }}{{ a.due ? ` · ${a.due}` : '' }}</span>
      </div>
    </div>
    <div v-if="r.nextDate" class="muted small" style="margin-top: 6px">下次：{{ r.nextDate }}</div>
    <!-- 导入的原始纪要：原文件、全文（点开再取） -->
    <div v-if="r.hasFile || r.sourceChars" class="source small">
      <span class="muted">原始纪要{{ r.parsedBy === 'AI' ? '（纪要和待办由模型整理）' : '' }}：</span>
      <a v-if="r.hasFile" :href="`api/one-on-ones/${r.id}/file`" target="_blank">📎 {{ r.sourceFileName || '原文件' }}</a>
      <el-button v-if="r.sourceChars" link size="small" type="primary" @click="toggleSource">{{ text != null ? '收起' : `看全文（${r.sourceChars} 字）` }}</el-button>
      <pre v-if="text != null" class="source-text">{{ text }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../api.js'
import { MOODS } from '../labels.js'
import { me } from '../me.js'

const props = defineProps({ r: { type: Object, required: true } })
const emit = defineEmits(['edit', 'remove', 'changed'])
const canTick = (a) => props.r.canEdit || (props.r.userId === me.user?.id && a.owner === 'EMPLOYEE')
const text = ref(null)
async function toggleSource() {
  if (text.value != null) { text.value = null; return }
  text.value = (await api.get(`one-on-ones/${props.r.id}/source`)).sourceText || ''
}
async function tick(a, v) {
  await api.post(`one-on-ones/${props.r.id}/action`, { index: a.index, done: v })
  a.done = v
  emit('changed')
}
</script>

<style scoped>
.one { margin-bottom: 10px; }
.head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; }
.private { margin-top: 8px; padding: 8px 10px; background: var(--hr-bg); border-radius: var(--hr-radius); }
.actions { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.act { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source-text { flex-basis: 100%; max-height: 320px; overflow: auto; white-space: pre-wrap; font-family: inherit; background: var(--hr-bg); border-radius: 6px; padding: 8px 10px; margin: 0; }
.done { text-decoration: line-through; color: var(--hr-muted); }
</style>
