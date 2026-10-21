<template>
  <div class="page">
    <div class="page-head">
      <h2>智能导入</h2>
      <div class="toolbar">
        <span class="muted small">余额按</span>
        <el-date-picker v-model="yearStr" type="year" value-format="YYYY" :clearable="false" style="width: 110px" />
        <span class="muted small">年算</span>
      </div>
    </div>
    <p class="help">把现有的员工花名册、假期余额表直接拖进来，或者用一句话说（「张三 2021 年 3 月入职，本科；李四年假还剩 5 天」）。先按规则认，认不出的列和写法交给以虎 One 的大模型；识别完先给你看要改什么，确认后才写入。姓名、部门、工号以平台为准，只用来对人。</p>

    <div class="card">
      <el-tabs v-model="mode">
        <el-tab-pane label="上传表格" name="file">
          <el-upload drag :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls,.csv" :on-change="onFile">
            <div class="drop">
              <div><b>拖一个 Excel / CSV 文件到这里</b>，或点击选择</div>
              <div class="muted small">第一行是表头（姓名或工号必须有一列）。常见的列：入职日期、参加工作日期、转正日期、出生日期、性别、学历、毕业院校、专业、职级、用工类型、工龄、司龄、年假余额、调休余额……写法不统一也没关系</div>
            </div>
          </el-upload>
          <div v-if="file.name" class="toolbar file-line">
            <span>{{ file.name }}</span>
            <el-select v-if="file.sheets.length > 1" v-model="file.sheet" style="width: 180px" @change="readSheet">
              <el-option v-for="s in file.sheets" :key="s" :value="s" :label="s" />
            </el-select>
            <span class="muted small">{{ file.rows.length ? `${file.rows.length - 1} 行` : '' }}</span>
            <el-button type="primary" :loading="busy" :disabled="file.rows.length < 2" @click="analyzeFile()">识别</el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="说一段话 / 粘贴" name="text">
          <el-input v-model="text" type="textarea" :rows="7" maxlength="20000" show-word-limit
            placeholder="例：&#10;张三，2021-03-01 入职，2015 年参加工作，本科，复旦大学计算机专业，P6&#10;李四今年年假还剩 5 天，调休 1.5 天&#10;王五 E0032 是实习生，明年 6 月毕业&#10;&#10;也可以直接从表格里复制几行粘贴进来（带表头）" />
          <div class="toolbar" style="margin-top: 10px">
            <el-button type="primary" :loading="busy" :disabled="!text.trim()" @click="analyzeText">识别</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template v-if="result">
      <el-alert v-if="result.ai.error" type="warning" :closable="false" :title="result.ai.error" style="margin-bottom: 12px" />
      <el-alert v-else-if="!result.ai.available" type="info" :closable="false" title="没接入以虎 One 的大模型，这次只按规则识别（表头和写法要比较规范）" style="margin-bottom: 12px" />

      <div v-if="result.columns" class="card">
        <div class="toolbar between">
          <h3>列对应</h3>
          <el-button size="small" :loading="busy" @click="analyzeFile(mapping)">按这个对应重新识别</el-button>
        </div>
        <div class="cols">
          <div v-for="(c, i) in result.columns" :key="i" class="col">
            <div class="h" :title="c.header">{{ c.header || `第 ${i + 1} 列` }}</div>
            <el-select v-model="mapping[i]" size="small" clearable placeholder="不导入" style="width: 100%">
              <el-option v-for="f in result.fields" :key="f.key" :value="f.key" :label="f.label" />
            </el-select>
            <div class="by small">{{ c.by === 'ai' ? '模型认的' : c.by === 'rule' ? '按表头' : '' }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="toolbar between">
          <h3>预览</h3>
          <el-radio-group v-model="filter" size="small">
            <el-radio-button value="confirm">待确认（{{ counts.confirm }}）</el-radio-button>
            <el-radio-button value="changes">要导入（{{ counts.included }}）</el-radio-button>
            <el-radio-button value="error">对不上（{{ counts.error }}）</el-radio-button>
            <el-radio-button value="all">全部（{{ result.rows.length }}）</el-radio-button>
          </el-radio-group>
        </div>
        <el-alert v-if="counts.confirm" type="warning" :closable="false" style="margin-bottom: 10px">
          <template #title>
            {{ counts.confirm }} 行的名字和平台上不完全一样（带备注、称呼、拼音、同音字……），给了最像的人，请确认是不是同一个人。确认过的名字会记住，下次直接认。
            <el-button size="small" style="margin-left: 8px" @click="acceptAll">全部采用建议</el-button>
          </template>
        </el-alert>
        <div class="table-wrap">
          <el-table :data="shown" size="small" row-key="row" max-height="560" :row-class-name="({ row }) => (dupOf(row) ? 'dup-row' : '')">
            <el-table-column width="40">
              <template #header><el-checkbox :model-value="allIncluded" :indeterminate="counts.included > 0 && !allIncluded" @change="toggleAll" /></template>
              <template #default="{ row }"><el-checkbox v-model="row.include" :disabled="!row.confirmed || !changesOf(row).length" /></template>
            </el-table-column>
            <el-table-column label="行" prop="row" width="50" />
            <el-table-column label="表里的人" min-width="110"><template #default="{ row }">{{ row.who.name }}<span v-if="row.who.jobNumber" class="muted small"> {{ row.who.jobNumber }}</span></template></el-table-column>
            <el-table-column label="对应员工" min-width="250">
              <template #default="{ row }">
                <template v-if="row.status === 'auto'">
                  {{ row.employee.name }} <span class="muted small">{{ row.employee.deptPath }} · 按{{ row.method }}</span>
                </template>
                <template v-else-if="row.status === 'confirm'">
                  <div class="pick">
                    <el-select v-model="row.pick" size="small" style="width: 210px" @change="row.confirmed = true; row.include = changesOf(row).length > 0">
                      <el-option v-for="c in row.candidates" :key="c.employee.id" :value="c.employee.id" :label="c.employee.name">
                        <span>{{ c.employee.name }}</span><span class="muted small" style="margin-left: 6px">{{ c.employee.deptPath }} · {{ c.reason }}</span>
                      </el-option>
                      <el-option :value="0" label="都不是，我自己选…" />
                    </el-select>
                    <el-button v-if="!row.confirmed && row.pick" size="small" type="primary" plain @click="confirmRow(row)">是他</el-button>
                    <el-tag v-else-if="row.confirmed && row.pick" size="small" type="success" disable-transitions>已确认</el-tag>
                  </div>
                  <div v-if="cand(row)" class="muted small">{{ cand(row).reason }}</div>
                  <EmployeePicker v-if="row.pick === 0" v-model="row.manual" size="small" placeholder="搜索姓名、工号" @update:model-value="pickManual(row, $event)" />
                </template>
                <template v-else-if="row.status === 'none'">
                  <span class="bad small">{{ row.error }}</span>
                  <EmployeePicker v-model="row.manual" placeholder="手工指定是谁…" @update:model-value="pickManual(row, $event)" />
                </template>
                <span v-else class="bad small">{{ row.error }}</span>
                <div v-if="dupOf(row)" class="bad small">和第 {{ dupOf(row) }} 行是同一个人，只能导一行</div>
              </template>
            </el-table-column>
            <el-table-column label="要改的" min-width="360">
              <template #default="{ row }">
                <div class="changes">
                  <span v-for="c in changesOf(row)" :key="c.field" class="chg" :title="c.derived ? `按「${c.derived}」推算` : ''">
                    <b>{{ c.label }}</b> <template v-if="!manualOnly(row)"><span class="muted">{{ c.fromText ?? '空' }}</span> → </template><span class="to">{{ c.toText }}</span><span v-if="c.derived" class="muted">（推算）</span>
                  </span>
                  <span v-if="row.confirmed && !changesOf(row).length" class="muted small">没有要改的</span>
                </div>
                <div v-if="row.unparsed.length" class="small warn">看不懂：{{ row.unparsed.map(u => `${u.label}「${u.raw}」`).join('、') }}</div>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="toolbar" style="margin-top: 12px">
          <el-button type="primary" :disabled="!counts.included || counts.dups > 0" :loading="saving" @click="apply">导入勾选的 {{ counts.included }} 人</el-button>
          <span v-if="counts.dups" class="bad small">有 {{ counts.dups }} 个人对应了好几行，先去掉多余的</span>
          <span class="muted small">余额是「设为」这个数（补一条导入流水），之后钉钉 / 飞书 / 企业微信里批的年假、调休会接着自动扣</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api.js'
import { thisYear } from '../labels.js'
import EmployeePicker from '../components/EmployeePicker.vue'

const yearStr = ref(String(thisYear()))
const mode = ref('file')
const text = ref('')
const busy = ref(false)
const saving = ref(false)
const result = ref(null)
const mapping = ref([])
const filter = ref('changes')
const file = reactive({ name: '', wb: null, sheets: [], sheet: '', rows: [] })

// 每一行：pick = 对到谁（0 = 自己选），confirmed = 人事确认过（直接认的算确认过），include = 要导入
const cand = (r) => r.candidates?.find(c => c.employee.id === r.pick)
const targetOf = (r) => (r.status === 'auto' ? r.employee.id : r.pick === 0 || r.status === 'none' ? r.manual || null : r.pick || null)
// 对到候选的按候选算出的改动；自己指定的人只有「要写成什么」（不知道原来的值，写入时再比）
const manualOnly = (r) => r.status !== 'auto' && !cand(r)
const changesOf = (r) => (r.status === 'auto' ? r.changes : cand(r) ? cand(r).changes : targetOf(r) ? r.proposed : [])
const included = computed(() => (result.value?.rows || []).filter(r => r.include && r.confirmed && targetOf(r) && changesOf(r).length))
const dupOf = (r) => {
  if (!r.include || !targetOf(r)) return null
  const first = included.value.find(x => targetOf(x) === targetOf(r))
  return first && first !== r ? first.row : null
}
const counts = computed(() => {
  const rows = result.value?.rows || []
  return {
    confirm: rows.filter(r => r.status === 'confirm' && !r.confirmed).length,
    included: included.value.length,
    error: rows.filter(r => (r.status === 'none' && !r.manual) || r.status === 'dup').length,
    dups: included.value.filter(dupOf).length
  }
})
const allIncluded = computed(() => {
  const can = (result.value?.rows || []).filter(r => r.confirmed && targetOf(r) && changesOf(r).length)
  return can.length > 0 && can.every(r => r.include)
})
function toggleAll(v) { for (const r of result.value.rows) if (r.confirmed && targetOf(r) && changesOf(r).length) r.include = v }
const shown = computed(() => {
  const rows = result.value?.rows || []
  if (filter.value === 'confirm') return rows.filter(r => r.status === 'confirm')
  if (filter.value === 'changes') return rows.filter(r => r.include)
  if (filter.value === 'error') return rows.filter(r => r.status === 'none' || r.status === 'dup')
  return rows
})
function confirmRow(r) { r.confirmed = true; r.include = changesOf(r).length > 0 }
function acceptAll() { for (const r of result.value.rows) if (r.status === 'confirm' && !r.confirmed && r.pick) confirmRow(r) }
function pickManual(r, id) { r.manual = id; r.confirmed = !!id; r.include = !!id && changesOf(r).length > 0 }

// Excel 解析放在浏览器里（按需加载，不进主包）；日期按 yyyy-mm-dd 输出，数字按显示的写法
async function onFile(f) {
  const XLSX = await import('xlsx')
  const buf = await f.raw.arrayBuffer()
  try {
    file.wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true })
  } catch (e) {
    return ElMessage.error(`读不了这个文件：${e.message}`)
  }
  Object.assign(file, { name: f.name, sheets: file.wb.SheetNames, sheet: file.wb.SheetNames[0] })
  await readSheet()
  analyzeFile()
}
async function readSheet() {
  const XLSX = await import('xlsx')
  const rows = XLSX.utils.sheet_to_json(file.wb.Sheets[file.sheet], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false })
  // 表头上面常有标题行：从第一行「有两格以上不空」的开始
  const start = rows.findIndex(r => r.filter(c => String(c).trim()).length >= 2)
  file.rows = start >= 0 ? rows.slice(start) : []
}

async function run(body) {
  busy.value = true
  try {
    const res = await api.post('import/analyze', { ...body, year: Number(yearStr.value) })
    for (const r of res.rows) {
      Object.assign(r, { pick: r.candidates?.[0]?.employee.id ?? null, manual: null, confirmed: r.status === 'auto' })
      r.include = r.status === 'auto' && r.changes.length > 0
    }
    result.value = reactive(res)
    mapping.value = (res.columns || []).map(c => c.field)
    filter.value = res.summary.toConfirm ? 'confirm' : res.summary.withChanges ? 'changes' : 'all'
  } finally { busy.value = false }
}
const analyzeFile = (m) => run({ rows: file.rows, ...(m ? { mapping: m } : {}) })
const analyzeText = () => run({ text: text.value })

async function apply() {
  const list = included.value
  const n = list.length
  const fields = list.reduce((s, r) => s + changesOf(r).length, 0)
  await ElMessageBox.confirm(`给 ${n} 人写入 ${fields} 项（档案、余额）？`, '确认导入', { type: 'warning' })
  saving.value = true
  try {
    // 名字不一样、人事确认了的：把表里的名字作为别名记下来
    const items = list.map(r => ({ userId: targetOf(r), changes: Object.fromEntries(changesOf(r).map(c => [c.field, c.to])), ...(r.status !== 'auto' && r.who.name ? { alias: r.who.name } : {}) }))
    const r = await api.post('import/apply', { items, year: result.value.year })
    if (r.errors.length) ElMessageBox.alert(r.errors.join('\n'), `已导入 ${r.people} 人，有 ${r.errors.length} 项没导`, { type: 'warning' })
    else ElMessage.success(`已导入 ${r.people} 人：档案 ${r.profileFields} 项、余额 ${r.balances} 项${r.aliases ? `；记住了 ${r.aliases} 个别名` : ''}`)
    // 重新识别一遍，看剩下的
    if (mode.value === 'file' && file.rows.length) analyzeFile(result.value.columns ? mapping.value : undefined)
    else result.value = null
  } finally { saving.value = false }
}
</script>

<style scoped>
.drop { padding: 8px 0; display: flex; flex-direction: column; gap: 6px; }
.file-line { margin-top: 10px; }
.between { justify-content: space-between; }
.cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.col .h { font-size: 12px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.col .by { color: var(--hr-muted); margin-top: 2px; min-height: 16px; }
.changes { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.chg { white-space: nowrap; }
.chg b { font-weight: 500; }
.to { color: var(--hr-primary); font-weight: 600; }
.bad { color: var(--hr-danger); }
.warn { color: var(--hr-warn); margin-top: 2px; }
.pick { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
:deep(.dup-row) td { background: var(--el-color-danger-light-9) !important; }
</style>
