<template>
  <div class="page advisor">
    <div class="page-head">
      <h2>分析建议<span class="muted small" style="margin-left: 8px; font-weight: normal">{{ me.hr ? '全公司' : '本部门' }} · 以虎 One 大模型</span></h2>
      <div class="toolbar">
        <el-button v-if="chat.messages.length" :disabled="busy" @click="reset">新对话</el-button>
      </div>
    </div>

    <div v-if="!me.platform?.connected" class="card muted">没有接入以虎 One（本地开发模式），用不了大模型。</div>

    <div class="thread">
      <div v-if="!chat.messages.length" class="card intro">
        <p>我会按你的权限查考勤、请假出差、合同、档案、1v1{{ me.cost ? '、人员成本' : '' }}，汇总成结论和方向性的建议。数字都来自本应用的数据，不改任何东西。</p>
        <p class="muted small">还没有接入 OKR / 目标数据。</p>
        <div class="starters">
          <el-button v-for="q in starters" :key="q" round @click="send(q)">{{ q }}</el-button>
        </div>
      </div>

      <div v-for="(m, i) in chat.messages" :key="i" class="msg" :class="m.role">
        <div v-if="m.role === 'user'" class="bubble">{{ m.content }}</div>
        <div v-else class="card answer">
          <div v-if="m.steps?.length" class="steps muted small">
            查了：<span v-for="(s, j) in m.steps" :key="j" :class="{ failed: !s.ok }" :title="s.ok ? JSON.stringify(s.args) : s.error">{{ toolLabel(s.tool) }}</span>
          </div>
          <div class="md" v-html="markdown(m.content)" />
        </div>
      </div>

      <div v-if="busy" class="card answer muted"><el-icon class="is-loading"><Loading /></el-icon> 正在查数据、分析……（复杂的问题要半分钟到一分钟）</div>
    </div>

    <div class="composer">
      <el-input
        v-model="draft" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" resize="none" :disabled="busy || !me.platform?.connected"
        placeholder="问点什么：哪个部门考勤在变差？哪些合同要处理？给我三条最该先做的建议（Enter 发送，Shift + Enter 换行）"
        @keydown.enter.exact.prevent="send()"
      />
      <el-button type="primary" :loading="busy" :disabled="!draft.trim() || !me.platform?.connected" @click="send()">发送</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { api } from '../api.js'
import { me } from '../me.js'
import { markdown } from '../markdown.js'

const TOOL_LABELS = {
  get_attendance_trend: '考勤趋势', get_team_monthly_attendance: '团队月度考勤', get_team_attendance: '当日出勤', get_my_attendance: '个人考勤',
  list_leave_records: '请假出差记录', get_my_leave_balance: '假期余额', list_leave_types: '假期类型',
  get_people_overview: '人员全景', get_employee_profile: '人员画像', list_expiring_contracts: '到期合同', list_one_on_ones: '1v1 记录',
  list_pending_decisions: '待决事项', get_key_metrics: '关键指标', get_daily_summary: '今日摘要'
}
const toolLabel = (t) => TOOL_LABELS[t] || t

const starters = computed(() => [
  '最近半年考勤整体怎么样？哪个部门在变差？',
  '人员方面现在最该关注的风险是什么？',
  '接下来两个月有哪些合同、试用期要处理？',
  ...(me.cost ? ['各部门的人员成本和人均怎么样？'] : []),
  '给我三条最该先做的管理建议'
])

// 对话只放在本页（刷新、换标签页保留，关掉就没了），不存服务器
const KEY = 'hr.advisor'
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || [] } catch { return [] } }
const chat = reactive({ messages: load() })
watch(() => chat.messages, (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)) } catch { /* 存不了就不存 */ } }, { deep: true })

const draft = ref('')
const busy = ref(false)
const toBottom = () => nextTick(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))

async function send(text) {
  const q = String(text ?? draft.value).trim()
  if (!q || busy.value) return
  chat.messages.push({ role: 'user', content: q })
  draft.value = ''
  busy.value = true
  toBottom()
  try {
    const r = await api.post('advisor/ask', { messages: chat.messages.map(({ role, content }) => ({ role, content })) })
    chat.messages.push({ role: 'assistant', content: r.answer, steps: r.steps })
  } catch {
    // 失败（api.js 已经提示了原因）：把问题放回输入框，可以直接重发
    chat.messages.pop()
    draft.value = q
  } finally {
    busy.value = false
    toBottom()
  }
}

function reset() {
  chat.messages = []
  draft.value = ''
}
</script>

<style scoped>
.advisor { max-width: 960px; }
.thread { padding-bottom: 12px; }
.intro p { margin: 0 0 8px; }
.starters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.starters .el-button { margin: 0; }
.msg.user { display: flex; justify-content: flex-end; margin-bottom: 16px; }
.bubble { max-width: 80%; background: var(--hr-primary-soft); border-radius: var(--hr-radius); padding: 10px 14px; white-space: pre-wrap; word-break: break-word; }
.steps { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.steps span { background: var(--hr-bg); border: 1px solid var(--hr-border); border-radius: 999px; padding: 0 8px; }
.steps span.failed { color: var(--hr-danger); border-color: var(--hr-danger); }
.composer { position: sticky; bottom: 0; display: flex; gap: 8px; align-items: flex-end; background: var(--hr-bg); padding: 12px 0 16px; }
.composer .el-textarea { flex: 1; }
.md { line-height: 1.7; word-break: break-word; }
.md :deep(p) { margin: 0 0 8px; }
.md :deep(h3), .md :deep(h4), .md :deep(h5) { margin: 14px 0 6px; font-size: 15px; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 8px; padding-left: 22px; }
.md :deep(code) { background: var(--hr-bg); padding: 0 4px; border-radius: 4px; }
.md :deep(hr) { border: none; border-top: 1px solid var(--hr-border); margin: 12px 0; }
.md :deep(.md-table) { overflow-x: auto; margin: 0 0 10px; }
.md :deep(table) { border-collapse: collapse; font-size: 13px; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--hr-border); padding: 4px 10px; text-align: left; white-space: nowrap; }
.md :deep(th) { background: var(--hr-bg); font-weight: 600; }
@media (max-width: 640px) { .bubble { max-width: 92%; } }
</style>
