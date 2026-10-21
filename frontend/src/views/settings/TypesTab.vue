<template>
  <div>
    <div class="toolbar" style="margin-bottom: 12px"><el-button type="primary" @click="openEdit()">新增假期类型</el-button></div>
    <div class="card table-wrap">
      <el-table v-loading="loading" :data="types" size="small">
        <el-table-column label="代码" prop="code" min-width="110" />
        <el-table-column label="名称" prop="name" min-width="80" />
        <el-table-column label="带薪" min-width="60"><template #default="{ row }">{{ row.paid ? '是' : '否' }}</template></el-table-column>
        <el-table-column label="扣余额" min-width="60"><template #default="{ row }">{{ row.balanced ? '是' : '否' }}</template></el-table-column>
        <el-table-column label="最小单位" min-width="70"><template #default="{ row }">{{ row.unit === 'DAY' ? '整天' : '半天' }}</template></el-table-column>
        <el-table-column label="启用" min-width="60"><template #default="{ row }"><el-tag :type="row.active ? 'success' : 'info'" size="small">{{ row.active ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="排序" prop="sort" min-width="50" />
        <el-table-column label="说明" prop="note" min-width="180" />
        <el-table-column label="" width="60" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </div>
    <p class="help">钉钉 / 飞书 / 企业微信同步来的请假按<b>名称</b>对上这里的类型（年休假 = 年假、调休假 = 调休），对上「扣余额」的类型就自动扣余额、撤销了退回；对不上的照样算进考勤，只是不扣余额。年假（ANNUAL）由「假期余额 → 发放年假」按工龄发；余额也可以在「智能导入」里按表导入。</p>

    <el-dialog v-model="edit.open" :title="edit.isNew ? '新增假期类型' : `编辑 · ${edit.form.name}`" width="min(460px, 94vw)">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="代码"><el-input v-model="edit.form.code" :disabled="!edit.isNew" placeholder="大写字母，如 NURSING" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="edit.form.name" maxlength="30" /></el-form-item>
        <el-form-item label="带薪"><el-switch v-model="edit.form.paid" /></el-form-item>
        <el-form-item label="扣余额"><el-switch v-model="edit.form.balanced" /></el-form-item>
        <el-form-item label="最小单位">
          <el-radio-group v-model="edit.form.unit"><el-radio value="HALF">半天</el-radio><el-radio value="DAY">整天</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="启用"><el-switch v-model="edit.form.active" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="edit.form.sort" :min="0" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="edit.form.note" maxlength="200" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.open = false">取消</el-button>
        <el-button type="primary" :loading="edit.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api.js'

const types = ref([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { types.value = await api.get('leave/types', { all: 1 }) } finally { loading.value = false }
}
onMounted(load)

const edit = reactive({ open: false, saving: false, isNew: false, form: {} })
function openEdit(row) {
  edit.isNew = !row
  edit.form = row ? { ...row } : { code: '', name: '', paid: true, balanced: false, unit: 'HALF', active: true, sort: (types.value.length + 1), note: '' }
  edit.open = true
}
async function save() {
  edit.saving = true
  try {
    await api.post('leave/types', edit.form)
    ElMessage.success('已保存')
    edit.open = false
    load()
  } finally { edit.saving = false }
}
</script>
