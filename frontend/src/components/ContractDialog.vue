<template>
  <el-dialog :model-value="modelValue" :title="title" width="min(600px, 96vw)" @update:model-value="$emit('update:modelValue', $event)">
    <el-form label-width="96px" @submit.prevent>
      <el-form-item label="员工">
        <EmployeePicker v-if="!form.id && !lockUser" v-model="form.userId" :initial="employee" />
        <span v-else>{{ employee?.name }}</span>
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="form.kind" style="width: 100%" :disabled="!!form.id">
          <el-option v-for="(l, k) in CONTRACT_KINDS" :key="k" :value="k" :label="l" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.kind === 'OTHER'" label="名称"><el-input v-model="form.title" maxlength="100" placeholder="如：股权激励协议" /></el-form-item>
      <el-form-item label="编号"><el-input v-model="form.number" maxlength="50" placeholder="选填" /></el-form-item>
      <el-form-item v-if="form.kind !== 'NON_COMPETE'" label="期限">
        <el-radio-group v-model="form.term">
          <el-radio-button v-for="(l, k) in CONTRACT_TERMS" :key="k" :value="k">{{ k === 'TASK' ? '按任务' : l }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="签订日"><el-date-picker v-model="form.signedDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
      <el-form-item label="生效日" required><el-date-picker v-model="form.startDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
      <el-form-item v-if="form.kind !== 'NON_COMPETE' && form.term !== 'OPEN'" label="到期日" :required="form.term === 'FIXED'">
        <el-date-picker v-model="form.endDate" value-format="YYYY-MM-DD" style="width: 100%" />
        <div class="help" v-if="form.term === 'FIXED' && form.startDate">
          快捷：<span v-for="y in [1, 2, 3, 5]" :key="y" class="link" style="margin-right: 10px" @click="setYears(y)">{{ y }} 年</span>
        </div>
      </el-form-item>
      <el-form-item v-if="form.kind === 'LABOR' && form.term !== 'TASK'" label="试用期至">
        <el-date-picker v-model="form.probationEnd" value-format="YYYY-MM-DD" style="width: 100%" placeholder="不约定试用期就留空" />
        <div class="help">法定上限：3 个月以上不满 1 年 1 个月，1 ~ 3 年 2 个月，3 年以上或无固定期限 6 个月；不满 3 个月不得约定</div>
      </el-form-item>
      <template v-if="form.kind === 'NON_COMPETE'">
        <el-form-item label="限制期（月）" required><el-input-number v-model="form.restrictMonths" :min="1" :max="24" /><span class="muted small" style="margin-left: 8px">离职日起算，最长 24 个月</span></el-form-item>
        <el-form-item label="每月补偿"><el-input-number v-model="form.monthlyComp" :min="0" :step="500" :precision="2" style="width: 180px" /><span class="muted small" style="margin-left: 8px">元，一般不低于离职前 12 个月平均工资的 30%</span></el-form-item>
      </template>
      <template v-if="form.kind === 'TRAINING'">
        <el-form-item label="服务期（月）"><el-input-number v-model="form.serviceMonths" :min="1" :max="240" /></el-form-item>
        <el-form-item label="违约金上限"><el-input-number v-model="form.penalty" :min="0" :step="1000" :precision="2" style="width: 180px" /><span class="muted small" style="margin-left: 8px">元，不超过公司提供的培训费用</span></el-form-item>
      </template>
      <el-form-item label="合同文件">
        <div style="width: 100%">
          <div v-if="form.fileKey" class="toolbar">
            <span>{{ form.fileName }}</span><span class="muted small">{{ size(form.fileSize) }}</span>
            <el-button link type="danger" @click="form.fileKey = null">移除</el-button>
          </div>
          <template v-else>
            <input ref="fileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style="display: none" @change="upload" />
            <el-button :loading="uploading" :disabled="!form.userId" @click="fileInput.click()">上传扫描件</el-button>
            <span class="muted small" style="margin-left: 8px">PDF / 图片 / Word，最大 50 MB；存在以虎 One 的文件存储里</span>
          </template>
          <el-progress v-if="uploading" :percentage="progress" :stroke-width="6" style="margin-top: 6px" />
        </div>
      </el-form-item>
      <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
    </el-form>
    <el-alert v-for="w in warnings" :key="w" type="warning" :title="w" :closable="false" style="margin-bottom: 6px" />
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { CONTRACT_KINDS, CONTRACT_TERMS } from '../labels.js'
import EmployeePicker from './EmployeePicker.vue'

// contract：要改的合同；renewOf：要续签的合同（带出员工和类型，生效日接上一份到期日的次日）；employee：预选的员工
const props = defineProps({ modelValue: Boolean, contract: Object, renewOf: Object, employee: Object, lockUser: Boolean })
const emit = defineEmits(['update:modelValue', 'saved'])
const form = ref({})
const warnings = ref([])
const saving = ref(false)
const uploading = ref(false)
const progress = ref(0)
const fileInput = ref(null)

const title = computed(() => (form.value.id ? '修改合同' : props.renewOf ? '续签' : '新建合同'))
const nextDay = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }

watch(() => props.modelValue, (open) => {
  if (!open) return
  warnings.value = []
  const c = props.contract, r = props.renewOf
  form.value = c
    ? { ...c }
    : { userId: r?.userId ?? props.employee?.id ?? null, kind: r?.kind || 'LABOR', term: r?.term || 'FIXED', startDate: r?.endDate ? nextDay(r.endDate) : '', endDate: '', signedDate: '', renewOfId: r?.id || null, restrictMonths: 12, monthlyComp: null, fileKey: null }
})

function setYears(y) {
  const t = new Date(form.value.startDate + 'T00:00:00Z')
  t.setUTCFullYear(t.getUTCFullYear() + y)
  t.setUTCDate(t.getUTCDate() - 1)
  form.value.endDate = t.toISOString().slice(0, 10)
}
const size = (n) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`) : '')

/** 直传七牛：先找应用要上传凭证（应用检查是不是人事），再表单 POST 给七牛 */
async function upload(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 50 * 1048576) return ElMessage.warning('文件太大（最大 50 MB）')
  uploading.value = true
  progress.value = 0
  try {
    const t = await api.post('contracts/upload-token', { userId: form.value.userId, fileName: file.name, size: file.size })
    const fd = new FormData()
    fd.append('token', t.token)
    fd.append('key', t.fullKey)
    fd.append('file', file)
    await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest()
      x.open('POST', t.uploadUrl)
      x.upload.onprogress = (ev) => { if (ev.lengthComputable) progress.value = Math.round(ev.loaded / ev.total * 100) }
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`上传失败（HTTP ${x.status}）`)))
      x.onerror = () => reject(new Error('上传失败：连不上文件存储'))
      x.send(fd)
    })
    Object.assign(form.value, { fileKey: t.key, fileName: file.name, fileSize: file.size })
  } catch (err) {
    ElMessage.error(err.message)
  } finally { uploading.value = false }
}

async function save() {
  if (!form.value.userId) return ElMessage.warning('选一个员工')
  saving.value = true
  try {
    const body = { ...form.value }
    for (const k of ['employee', 'status', 'statusLabel', 'kindLabel', 'termLabel', 'daysLeft', 'restrictWindow', 'hasFile', 'inProbation', 'updatedAt']) delete body[k]
    const r = await api.post('contracts', body)
    if (r.warnings?.length) {
      warnings.value = r.warnings
      ElMessage.warning('已保存，有需要注意的地方')
    } else {
      ElMessage.success('已保存')
      emit('update:modelValue', false)
    }
    emit('saved', r.contract)
  } finally { saving.value = false }
}
</script>
