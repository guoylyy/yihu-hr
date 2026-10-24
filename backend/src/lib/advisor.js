// 分析建议助手的纯逻辑：对话整理、工具声明转换、工具结果裁剪、考勤趋势汇总、提示词
import { addMonths } from './contracts.js'

export const MAX_TURNS = 20 // 只带最近 20 条对话
export const MAX_MESSAGE = 4000 // 一条对话最多带多少字
export const MAX_RESULT = 12000 // 一次工具结果最多给模型多少字
export const MAX_ROUNDS = 6 // 一个问题最多调几轮工具

/** 前端带来的对话：只留 user / assistant 的文字，截短，最后一条必须是用户的问题 */
export function cleanHistory(messages) {
  const list = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE) }))
    .slice(-MAX_TURNS)
  while (list.length && list[0].role !== 'user') list.shift()
  if (!list.length || list[list.length - 1].role !== 'user') return null
  return list
}

/** MCP 的工具 → OpenAI tools。只给只读的：助手只分析，不改数据 */
export function toLlmTools(tools) {
  return tools
    .filter(t => t.annotations?.readOnlyHint)
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
}

/** 模型给的参数（JSON 字符串），解析不了当空 */
export function parseArgs(s) {
  if (!s) return {}
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** 工具结果给模型：太长的截断并说明，不让一个结果撑满上下文 */
export function clipResult(out, max = MAX_RESULT) {
  const s = typeof out === 'string' ? out : JSON.stringify(out)
  return s.length <= max ? s : `${s.slice(0, max)}……（结果太长，已截断。需要细节就缩小范围再查：指定部门、月份或某个人）`
}

/** ym 往前数 n 个月（含 ym），从早到晚 */
export function monthsBack(ym, n) {
  return Array.from({ length: n }, (_, i) => addMonths(`${ym}-01`, i - n + 1).slice(0, 7))
}

const KEYS = ['due', 'normal', 'abnormal', 'noData', 'late', 'early', 'missing', 'absent', 'leaveDays', 'tripDays']
const round = (x) => Math.round(x * 100) / 100
const rate = (s) => (s.due ? Math.min(100, Math.round(s.normal / s.due * 1000) / 10) : null)

/** 一个月的考勤月报行（不含免考勤的）按部门汇总：人数、各类异常次数、请假出差天数、正常出勤率 */
export function byDept(rows) {
  const m = new Map()
  for (const r of rows) {
    if (r.exempt) continue
    const dept = r.employee?.deptPath || '未分部门'
    const d = m.get(dept) || m.set(dept, { dept, people: 0, ...Object.fromEntries(KEYS.map(k => [k, 0])) }).get(dept)
    d.people++
    for (const k of KEYS) d[k] += Number(r[k]) || 0
  }
  return [...m.values()]
    .map(d => ({ ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])), normalRate: rate(d) }))
    .sort((a, b) => (a.normalRate ?? 101) - (b.normalRate ?? 101))
}

/** 各部门加起来：整个范围这个月的合计和正常出勤率 */
export function sumDepts(depts) {
  const t = { people: 0, ...Object.fromEntries(KEYS.map(k => [k, 0])) }
  for (const d of depts) for (const k of Object.keys(t)) t[k] += d[k] || 0
  return { ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v)])), normalRate: rate(t) }
}

/** 几个月里时间类异常（迟到 + 早退 + 缺卡 + 旷工）最多的人；months = [{ month, rows }] */
export function topAbnormal(months, n = 10) {
  const m = new Map()
  for (const { month, rows } of months) {
    for (const r of rows) {
      if (r.exempt) continue
      const k = r.employee.id
      const p = m.get(k) || m.set(k, { name: r.employee.name, dept: r.employee.deptPath, late: 0, early: 0, missing: 0, absent: 0, total: 0, byMonth: {} }).get(k)
      const t = (r.late || 0) + (r.early || 0) + (r.missing || 0) + (r.absent || 0)
      p.late += r.late || 0; p.early += r.early || 0; p.missing += r.missing || 0; p.absent += r.absent || 0; p.total += t
      p.byMonth[month] = t
    }
  }
  return [...m.values()].filter(p => p.total > 0).sort((a, b) => b.total - a.total).slice(0, n)
}

/**
 * 工具循环：模型要数据就调工具（只认只读的），结果回给它，直到它给出回答；最后一轮不许再调工具，逼它用手上的数据作答。
 * llm(opts) 同 OpenAI chat.completions；tools 是 MCP 的工具（带 run）。返回 { answer, steps, rounds }
 */
export async function runAdvisor({ llm, tools, messages, ctx, maxRounds = MAX_ROUNDS }) {
  const convo = [...messages]
  const decls = toLlmTools(tools)
  const steps = []
  for (let round = 0; ; round++) {
    const last = round >= maxRounds
    const r = await llm({ temperature: 0.3, messages: convo, tools: decls, ...(last ? { tool_choice: 'none' } : {}) })
    const msg = r.choices?.[0]?.message || {}
    const calls = last ? [] : (msg.tool_calls || [])
    if (!calls.length) return { answer: String(msg.content || '').trim() || '没能给出回答，换个问法试试', steps, rounds: round }
    convo.push({ role: 'assistant', content: msg.content || '', tool_calls: calls })
    for (const c of calls) {
      const name = c.function?.name
      const args = parseArgs(c.function?.arguments)
      const tool = tools.find(t => t.name === name && t.annotations?.readOnlyHint)
      let content
      try {
        if (!tool) throw Object.assign(new Error(`没有只读工具 ${name}`), { status: 400 })
        content = clipResult(await tool.run(ctx, args))
        steps.push({ tool: name, args, ok: true })
      } catch (e) {
        if (!e.status) console.error('[hr] advisor', name, e)
        const error = e.status ? e.message : '查询失败'
        content = `出错：${error}`
        steps.push({ tool: name, args, ok: false, error })
      }
      convo.push({ role: 'tool', tool_call_id: c.id, content })
    }
  }
}

/** 系统提示词：数据从工具来，不编；给方向性建议；按权限说话 */
export function systemPrompt({ today, user, hr, sources = [] }) {
  return `你是「人事考勤」应用里的分析建议助手，帮${hr ? '人事' : '部门负责人'}看懂人员和考勤数据、找出问题、给出方向性的建议。今天是 ${today}，提问的是 ${user.name}（${hr ? '人事，能看全公司' : '部门负责人，只能看自己负责的部门'}）。

能用的数据（都通过工具查，工具已经按提问人的权限收好范围）：
- 考勤：打卡结果和请假、出差、外出，都从${sources.length ? sources.join('、') : '钉钉 / 飞书 / 企业微信'}同步，只读。免考勤的人不算进考勤统计
- 人员：档案、司龄、入离职、合同与协议（到期、缺失、试用期、竞业限制）、1v1（覆盖率、状态、待办）、人员成本（有权限才有）
- 还没有 OKR / 目标数据；问到时直说还没接入，可以先从考勤、人员这些侧面看

做法：
1. 先想清楚要哪些数据，调工具查；看趋势用 get_attendance_trend，看全貌用 get_people_overview，看某个人用 get_employee_profile。不够就再查，别凭印象回答
2. 只说数据里有的，数字照抄工具结果，不估、不编；数据不全（没同步到、没录合同、样本太少）要点明，结论相应放软
3. 回答用中文 Markdown，结构：**结论**（一两句）→ **发现**（带数字、和上月 / 其他部门比）→ **建议**（3 ~ 5 条，说清楚做什么、谁来做、先做哪个，是方向不是命令）→ 需要的话「还可以看」
4. 说到具体的人就事论事，不给人贴标签，不推测私生活、健康、离职意图；涉及人员成本、1v1 状态的，提醒只在管理范围内使用
5. 工具报错或没权限，照实说，不要换个说法绕过去
6. 你只分析、不改数据；要改档案、记 1v1、处理请假，告诉用户去哪个页面或去钉钉 / 飞书 / 企业微信`
}
