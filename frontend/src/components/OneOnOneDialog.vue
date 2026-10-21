<template>
  <el-dialog :model-value="modelValue" :title="form.id ? '修改 1v1 记录' : `记一次 1v1${employee ? ' · ' + employee.name : ''}`" width="min(640px, 96vw)" @update:model-value="$emit('update:modelValue', $event)">
    <el-form label-width="76px" @submit.prevent>
      <el-form-item v-if="!form.id && !employee" label="和谁"><EmployeePicker v-model="form.userId" placeholder="选一位下属" /></el-form-item>

      <!-- 从会议纪要导入：传文件或粘贴，解析好填进下面的表单 -->
      <div class="import">
        <div class="row">
          <b>从会议纪要导入</b>
          <input ref="fileInput" type="file" :accept="ACCEPT" style="display: none" @change="onFile" />
          <el-button size="small" type="primary" plain :loading="imp.busy && imp.mode === 'file'" :disabled="!form.userId || imp.busy" @click="fileInput.click()">上传纪要文件</el-button>
          <el-button size="small" :disabled="!form.userId || imp.busy" @click="imp.paste = !imp.paste">粘贴文字</el-button>
          <span class="muted small">飞书妙记、钉钉闪记、腾讯会议导出的纪要 / 文字稿（Word、PDF、txt、字幕 srt / vtt）</span>
        </div>
        <template v-if="imp.paste">
          <el-input v-model="imp.text" type="textarea" :rows="5" placeholder="把会议纪要或录音转写的文字粘贴进来" style="margin-top: 8px" />
          <el-button size="small" type="primary" style="margin-top: 6px" :loading="imp.busy && imp.mode === 'text'" :disabled="!imp.text.trim()" @click="parse({ text: imp.text }, 'text')">解析</el-button>
        </template>
        <el-progress v-if="imp.busy && imp.progress < 100 && imp.mode === 'file'" :percentage="imp.progress" :stroke-width="5" style="margin-top: 6px" />
        <div v-if="imp.busy" class="muted small" style="margin-top: 4px">{{ imp.progress < 100 && imp.mode === 'file' ? '上传中…' : '正在读纪要、整理要点和待办…' }}</div>
        <el-alert v-if="imp.done" :type="imp.done.by === 'AI' ? 'success' : 'warning'" :closable="false" style="margin-top: 8px"
          :title="imp.done.by === 'AI' ? '已按纪要整理好纪要、话题、待办、状态，请检查修改后再保存' : imp.done.aiError" />
        <div v-if="form.sourceText || form.sourceFileName" class="source">
          <span v-if="form.sourceFileName">📎 <a v-if="form.id && hasSavedFile" :href="`api/one-on-ones/${form.id}/file`" target="_blank">{{ form.sourceFileName }}</a><template v-else>{{ form.sourceFileName }}</template></span>
          <span v-else-if="form.sourceText" class="muted small">粘贴的文字</span>
          <el-button v-if="form.sourceText" link size="small" type="primary" @click="imp.showText = !imp.showText">{{ imp.showText ? '收起' : '看' }}原始纪要（{{ form.sourceText.length }} 字）</el-button>
          <el-button link size="small" type="danger" @click="clearSource">去掉</el-button>
          <el-checkbox v-model="form.sourceShared" size="small">原始纪要也给本人看</el-checkbox>
          <pre v-if="imp.showText" class="source-text">{{ form.sourceText }}</pre>
        </div>
        <div v-if="!imp.storage" class="muted small" style="margin-top: 4px">平台没开文件存储：原文件不保存，只保存从里面读出的文字</div>
      </div>

      <el-form-item label="日期">
        <el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 160px" />
        <el-input-number v-model="form.minutes" :min="5" :max="600" :step="5" controls-position="right" style="width: 120px; margin-left: 8px" /><span class="muted small" style="margin-left: 6px">分钟</span>
      </el-form-item>
      <el-form-item label="状态">
        <el-rate v-model="form.mood" :texts="Object.values(MOODS)" show-text clearable />
        <span class="muted small" style="margin-left: 8px">对方最近的状态，本人看不到</span>
        <div v-if="imp.done?.draft?.moodReason" class="muted small" style="width: 100%">模型的判断：{{ imp.done.draft.moodReason }}</div>
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
import { reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { MOODS, TOPICS, today } from '../labels.js'
import EmployeePicker from './EmployeePicker.vue'

const props = defineProps({ modelValue: Boolean, record: Object, employee: Object })
const emit = defineEmits(['update:modelValue', 'saved'])
const form = ref({ topics: [], actions: [] })
const saving = ref(false)
const ACCEPT = '.txt,.md,.docx,.pdf,.srt,.vtt'
const fileInput = ref(null)
const imp = reactive({ busy: false, mode: '', progress: 0, paste: false, text: '', done: null, showText: false, storage: true })
const hasSavedFile = ref(false)

watch(() => props.modelValue, (open) => {
  if (!open) return
  const r = props.record
  form.value = r
    ? { id: r.id, userId: r.userId, date: r.date, minutes: r.minutes, mood: r.mood || 0, topics: [...(r.topics || [])], notes: r.notes || '', privateNote: r.privateNote || '', actions: r.actions.map(a => ({ text: a.text, owner: a.owner, due: a.due, done: a.done })), nextDate: r.nextDate, shared: r.shared, sourceShared: !!r.sourceShared, sourceFileName: r.sourceFileName || null }
    : { userId: props.employee?.id ?? null, date: today(), minutes: 30, mood: 0, topics: [], notes: '', privateNote: '', actions: [], nextDate: null, shared: true, sourceShared: false }
  Object.assign(imp, { busy: false, paste: false, text: '', done: null, showText: false, storage: true })
  hasSavedFile.value = !!r?.hasFile
  // 改记录：原始纪要的全文点开再取
  if (r?.sourceChars) api.get(`one-on-ones/${r.id}/source`).then(x => { form.value.sourceText = x.sourceText })
})

const base = () => (form.value.id ? { recordId: form.value.id } : { userId: form.value.userId })

/** 传文件：平台开了文件存储就直传（原文件跟着记录存），没开就把文件交给解析（只留文字） */
async function onFile(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 50 * 1048576) return ElMessage.warning('文件太大（最大 50 MB）')
  Object.assign(imp, { busy: true, mode: 'file', progress: 0 })
  try {
    const t = await api.post('one-on-ones/upload-token', { ...base(), fileName: file.name, size: file.size })
    imp.storage = t.storage
    if (t.storage) {
      const fd = new FormData()
      fd.append('token', t.token)
      fd.append('key', t.fullKey)
      fd.append('file', file)
      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest()
        x.open('POST', t.uploadUrl)
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) imp.progress = Math.round(ev.loaded / ev.total * 100) }
        x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`上传失败（HTTP ${x.status}）`)))
        x.onerror = () => reject(new Error('上传失败：连不上文件存储'))
        x.send(fd)
      })
      imp.progress = 100
      await parse({ fileKey: t.key, fileName: file.name }, 'file', true)
    } else {
      if (file.size > 4 * 1048576) throw new Error('平台没开文件存储时最多传 4 MB 的文件')
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1])
        fr.onerror = () => reject(new Error('读不了这个文件'))
        fr.readAsDataURL(file)
      })
      imp.progress = 100
      await parse({ fileBase64: b64, fileName: file.name }, 'file', true)
      form.value.sourceFileName = null
    }
  } catch (err) {
    if (err.message) ElMessage.error(err.message)
  } finally { imp.busy = false }
}

/** 解析，把草稿填进表单（已经填了东西的先问一下） */
async function parse(body, mode, busyHeld) {
  if (!busyHeld) Object.assign(imp, { busy: true, mode })
  try {
    const r = await api.post('one-on-ones/parse', { ...base(), ...body })
    const f = form.value
    if ((f.notes?.trim() || f.actions.some(a => a.text.trim())) && !(await ElMessageBox.confirm('用纪要解析的结果替换现在填的纪要、话题和待办？私人备注会追加在后面。', '导入纪要', { type: 'warning', confirmButtonText: '替换', cancelButtonText: '只保存原文' }).then(() => true, () => false))) {
      Object.assign(f, sourceFields(r))
      imp.done = null
    } else {
      const d = r.draft
      Object.assign(f, {
        ...sourceFields(r),
        ...(d.date ? { date: d.date } : {}), ...(d.minutes ? { minutes: d.minutes } : {}), ...(d.mood ? { mood: d.mood } : {}), ...(d.nextDate ? { nextDate: d.nextDate } : {}),
        topics: d.topics.length ? d.topics : f.topics,
        notes: d.summary || f.notes,
        actions: d.actions.length ? d.actions : f.actions,
        privateNote: d.observations ? [f.privateNote, d.observations].filter(Boolean).join('\n') : f.privateNote
      })
      imp.done = r
    }
    imp.paste = false
  } finally { if (!busyHeld) imp.busy = false }
}
const sourceFields = (r) => ({
  sourceText: r.sourceText, sourceFileKey: r.file?.key ?? null, sourceFileName: r.file?.name ?? null, sourceFileSize: r.file?.size ?? null,
  parsed: { ...r.draft, by: r.by, at: r.parsedAt }
})
function clearSource() {
  Object.assign(form.value, { sourceText: null, sourceFileKey: null, sourceFileName: null, sourceFileSize: null, parsed: null })
  hasSavedFile.value = false
  imp.done = null
}

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
.import { margin: 0 0 14px 76px; padding: 10px 12px; border: 1px dashed var(--hr-border); border-radius: var(--hr-radius); background: var(--hr-bg); }
.import .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source-text { flex-basis: 100%; max-height: 260px; overflow: auto; white-space: pre-wrap; font-family: inherit; font-size: 12px; background: var(--hr-surface); border: 1px solid var(--hr-border); border-radius: 6px; padding: 8px 10px; margin: 0; }
@media (max-width: 760px) { .import { margin-left: 0; } }
.action-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.action-row .el-input { flex: 1; min-width: 160px; }
</style>
