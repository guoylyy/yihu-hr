<template>
  <div>
    <div class="toolbar" style="margin-bottom: 12px">
      <el-date-picker v-model="year" type="year" value-format="YYYY" :clearable="false" style="width: 110px" @change="load" />
      <el-button type="primary" @click="imp.open = true">录入</el-button>
    </div>
    <div class="card table-wrap">
      <el-table v-loading="loading" :data="list" size="small" empty-text="这一年还没有录入节假日">
        <el-table-column label="日期" min-width="110"><template #default="{ row }">{{ row.date }} 周{{ weekdayOf(row.date) }}</template></el-table-column>
        <el-table-column label="类型" min-width="80">
          <template #default="{ row }"><el-tag :type="row.kind === 'HOLIDAY' ? 'success' : 'warning'" size="small">{{ row.kind === 'HOLIDAY' ? '放假' : '调休上班' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="名称" prop="name" min-width="120" />
        <el-table-column label="" width="60" fixed="right"><template #default="{ row }"><el-button link type="danger" @click="del(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>
    <p class="help">每年国务院公布放假安排后录一次。周末默认不上班（在「规则」里改），调休上班的周末要录成「班」。</p>

    <el-dialog v-model="imp.open" title="录入节假日" width="min(520px, 96vw)">
      <p class="help">每行一天：日期 类型 名称。类型写「休」（放假）或「班」（调休上班）。已有的日期会被覆盖。</p>
      <el-input v-model="imp.text" type="textarea" :rows="12" placeholder="2026-10-01 休 国庆节&#10;2026-10-02 休 国庆节&#10;2026-10-11 班 国庆调休" />
      <template #footer>
        <el-button @click="imp.open = false">取消</el-button>
        <el-button type="primary" :loading="imp.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api.js'
import { thisYear, weekdayOf } from '../../labels.js'

const year = ref(String(thisYear()))
const list = ref([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { list.value = await api.get('holidays', { year: year.value }) } finally { loading.value = false }
}
onMounted(load)

const imp = reactive({ open: false, saving: false, text: '' })
async function save() {
  imp.saving = true
  try {
    const r = await api.post('holidays/import', { text: imp.text })
    ElMessage.success(`已保存 ${r.saved} 天`)
    imp.open = false
    imp.text = ''
    load()
  } finally { imp.saving = false }
}
async function del(row) {
  await ElMessageBox.confirm(`删除 ${row.date}？`, '删除', { type: 'warning' })
  await api.del(`holidays/${row.date}`)
  load()
}
</script>
