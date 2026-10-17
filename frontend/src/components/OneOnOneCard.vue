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
  </div>
</template>

<script setup>
import { api } from '../api.js'
import { MOODS } from '../labels.js'
import { me } from '../me.js'

const props = defineProps({ r: { type: Object, required: true } })
const emit = defineEmits(['edit', 'remove', 'changed'])
const canTick = (a) => props.r.canEdit || (props.r.userId === me.user?.id && a.owner === 'EMPLOYEE')
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
.done { text-decoration: line-through; color: var(--hr-muted); }
</style>
