// 智能导入（人事）：一张员工表（Excel / CSV，浏览器里解析好按行传上来）或一段话 → 预览要改什么 → 确认后写入。
//   - 表格：规则先对表头（lib/importer.js），对不上的列交给平台大模型认；值先按规则规范，规则解析不了的再让模型规范
//   - 一段话（「张三 2021 年 3 月入职，本科；李四年假还剩 5 天」）或粘贴的表格：让模型抽成一条条记录，再走同样的规范化
//   - 能导：档案（入职 / 参加工作 / 转正 / 离职 / 出生日期、性别、学历、院校、专业、职级、用工类型、标签、工龄 / 司龄推算）和假期余额（设为某个数）
//   - 姓名、部门、工号以平台为准，只用来对人，不改
// 大模型是平台托管的（应用拿不到密钥）；没接入平台时只用规则。发给模型的是表头和要认的值，确认前什么都不写
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { ws } from '../lib/platform.js'
import { currentYear } from '../lib/dates.js'
import { EXEMPTIONS } from '../lib/exemption.js'
import { EDUCATION_LEVELS, EMPLOYMENT_CODES, PROFILE_FIELDS, balanceFields, diffRecord, guessMapping, matchEmployee, normalizeValue } from '../lib/importer.js'
import { requireHr } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { setBalance } from './balance.js'
import { getSettings } from './settings.js'
import { today as todayStr } from './contracts.js'

const MAX_ROWS = 3000
const MAX_TEXT = 20000
const PROFILE_KEYS = ['hireDate', 'workStartDate', 'regularDate', 'leaveDate', 'birthDate', 'gender', 'education', 'school', 'major', 'level', 'employmentType', 'tags', 'exemption', 'exemptNote']
const DATE_KEYS = new Set(['hireDate', 'workStartDate', 'regularDate', 'leaveDate', 'birthDate'])
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

async function allFields() {
  const types = await prisma.leaveType.findMany({ where: { active: true }, orderBy: { sort: 'asc' } })
  return [...PROFILE_FIELDS, ...balanceFields(types)]
}

const fieldDoc = (fields) => fields.map(f => `- ${f.key}：${f.label}${f.kind === 'date' ? '（YYYY-MM-DD）' : f.kind === 'gender' ? '（M 男 / F 女）' : f.kind === 'education' ? `（${EDUCATION_LEVELS.join(' / ')}）` : f.kind === 'employment' ? `（${Object.entries(EMPLOYMENT_CODES).map(([k, v]) => `${k} ${v}`).join(' / ')}）` : f.kind === 'balance' ? '（剩余天数，数字）' : f.kind === 'exemption' ? '（ATTENDANCE 免考勤：不进考勤统计 / FULL 免考勤且不参与考核：如董事，人员指标和成本统计都不算 / NONE 正常）' : ''}`).join('\n')

// ---------- 大模型 ----------
const aiReady = () => ws.enabled

/** 调平台大模型，要一个 JSON 对象回来（容忍 ```json 包着、前后有字） */
async function askJson(system, user) {
  const r = await ws.llm({ temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  const text = r.choices?.[0]?.message?.content || ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('模型没有返回 JSON')
  return JSON.parse(m[0])
}

const SYSTEM = '你是人事系统的数据导入助手。只输出一个 JSON 对象，不要解释。拿不准的宁可给 null，不要编造。'

/** 表头没对上的列：让模型看表头和样例认一认 */
async function aiMapColumns(headers, samples, fields, mapping) {
  const free = fields.filter(f => !mapping.includes(f.key))
  const todo = headers.map((h, i) => ({ i, h })).filter(x => !mapping[x.i] && String(x.h ?? '').trim())
  if (!todo.length || !free.length) return mapping
  const cols = todo.map(x => `${x.i}. 「${x.h}」样例：${samples.map(r => JSON.stringify(r[x.i] ?? '')).join('、')}`).join('\n')
  const j = await askJson(SYSTEM, `一张员工表里有这些列还没对上字段：\n${cols}\n\n可选的字段：\n${fieldDoc(free)}\n\n把能对上的列对到一个字段（一个字段只对一列），对不上的（如部门、手机号、备注）给 null。输出：{"columns":[{"index":列号,"field":"字段 key 或 null"}]}`)
  const out = [...mapping]
  const keys = new Set(free.map(f => f.key))
  for (const c of j.columns || []) {
    const i = Number(c.index)
    if (todo.some(x => x.i === i) && keys.has(c.field) && !out.includes(c.field)) out[i] = c.field
  }
  return out
}

/** 规则解析不了的值：按字段一批批让模型规范，返回 Map(field -> Map(原值 -> 规范值)) */
async function aiNormalize(unparsedByField, fields, today) {
  const out = new Map()
  for (const [key, values] of unparsedByField) {
    const f = fields.find(x => x.key === key)
    if (!f) continue
    const list = [...values].slice(0, 200)
    const want = f.kind === 'years' ? '年数（数字）' : f.kind === 'tags' ? '标签数组' : f.label + (f.kind === 'date' ? '，格式 YYYY-MM-DD' : '')
    const j = await askJson(SYSTEM, `今天是 ${today}。把下面这些「${f.label}」的原始写法规范成：${want}。\n${fieldDoc([f])}\n原始值：${JSON.stringify(list)}\n输出：{"values":{"原始值":"规范后的值或 null"}}`)
    out.set(key, new Map(Object.entries(j.values || {})))
  }
  return out
}

/** 一段话 / 粘贴的表格 → 记录 [{ name, jobNumber, values: { field: 值 } }] */
async function aiExtract(text, fields, today) {
  const j = await askJson(SYSTEM, `今天是 ${today}。从下面的内容里提取员工信息（可能是一段话，也可能是从表格粘贴的文字）。\n可用的字段：\n${fieldDoc(fields.filter(f => f.kind !== 'who'))}\n\n每个人一条，name 写姓名，有工号写 jobNumber；只写内容里明确提到的字段，日期换成 YYYY-MM-DD（「今年 3 月」这类按今天推算），余额写剩余天数。\n输出：{"records":[{"name":"张三","jobNumber":null,"values":{"hireDate":"2021-03-01","balance:ANNUAL":5}}]}\n\n内容：\n${text}`)
  return (j.records || []).slice(0, MAX_ROWS).map(r => ({ name: r.name, jobNumber: r.jobNumber, values: r.values || {} }))
}

// ---------- 表格的规则兜底（没有模型时也能导粘贴的表格） ----------
function splitTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const sep = lines.some(l => l.includes('\t')) ? '\t' : /[,，]/
  return lines.map(l => l.split(sep).map(x => x.trim()))
}

// ---------- 对比现有数据 ----------
async function currentValues(emps, fields, year) {
  const balanceCodes = fields.filter(f => f.kind === 'balance').map(f => f.typeCode)
  const ledger = balanceCodes.length
    ? await prisma.leaveLedger.groupBy({ by: ['userId', 'typeCode'], where: { year, typeCode: { in: balanceCodes }, userId: { in: emps.map(e => e.id) } }, _sum: { delta: true } })
    : []
  const bal = new Map(ledger.map(g => [`${g.userId}:${g.typeCode}`, Math.round(Number(g._sum.delta || 0) * 100) / 100]))
  return (e) => {
    const cur = {}
    for (const k of PROFILE_KEYS) cur[k] = DATE_KEYS.has(k) ? ymd(e[k]) : k === 'tags' ? (Array.isArray(e.tags) ? e.tags : []) : k === 'exemption' ? e.exemption || 'NONE' : e[k] ?? null
    for (const c of balanceCodes) cur[`balance:${c}`] = bal.get(`${e.id}:${c}`) ?? 0
    return cur
  }
}

function fmtValue(f, v) {
  if (v == null || v === '') return null
  if (f?.kind === 'gender') return v === 'M' ? '男' : v === 'F' ? '女' : v
  if (f?.kind === 'employment') return EMPLOYMENT_CODES[v] || v
  if (f?.kind === 'exemption') return EXEMPTIONS[v] || '正常'
  if (Array.isArray(v)) return v.join('、')
  return v
}

/**
 * 识别：返回预览，不写数据。
 * body：{ rows: 二维数组（第一行是表头）, sheet?, mapping?: [字段 key | null]（人事改过的列对应，给了就不再让模型认）, year? }
 *    或 { text: '一段话或粘贴的表格', year? }
 */
export async function analyze(ctx, body = {}) {
  await requireHr(ctx)
  const s = await getSettings()
  const today = await todayStr()
  const year = Number(body.year) || currentYear(s.timezone)
  const fields = await allFields()
  const ai = { used: false, available: aiReady(), error: null }
  const tryAi = async (fn, fallback) => {
    if (!aiReady()) return fallback
    try {
      const r = await fn()
      ai.used = true
      return r
    } catch (e) {
      ai.error = `大模型没用上（${e.message}），只按规则识别`
      return fallback
    }
  }

  let records = [], columns = null
  if (Array.isArray(body.rows)) {
    const nonEmpty = body.rows.filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim()))
    // 表头上面常有标题行（「2026 年花名册」）：从第一行有两格以上不空的开始
    const start = nonEmpty.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 2)
    const rows = start >= 0 ? nonEmpty.slice(start) : []
    if (rows.length < 2) throw badRequest('表里至少要有表头和一行数据')
    if (rows.length > MAX_ROWS + 1) throw badRequest(`一次最多导 ${MAX_ROWS} 行`)
    const headers = rows[0].map(h => String(h ?? '').trim())
    const data = rows.slice(1)
    let mapping
    if (Array.isArray(body.mapping)) {
      const keys = new Set(fields.map(f => f.key))
      mapping = headers.map((_, i) => (keys.has(body.mapping[i]) ? body.mapping[i] : null))
    } else {
      mapping = guessMapping(headers, fields)
      const ruled = [...mapping]
      mapping = await tryAi(() => aiMapColumns(headers, data.slice(0, 5), fields, mapping), mapping)
      columns = headers.map((h, i) => ({ index: i, header: h, field: mapping[i], by: mapping[i] ? (ruled[i] ? 'rule' : 'ai') : null }))
    }
    columns = columns || headers.map((h, i) => ({ index: i, header: h, field: mapping[i], by: mapping[i] ? 'manual' : null }))
    if (!mapping.includes('name') && !mapping.includes('jobNumber')) throw badRequest('没找到姓名或工号列，请在「列对应」里指定')
    records = data.map((r, i) => {
      const rec = { row: i + 2, name: null, jobNumber: null, values: {} }
      mapping.forEach((k, c) => {
        if (!k) return
        if (k === 'name' || k === 'jobNumber') rec[k] = String(r[c] ?? '').trim() || null
        else rec.values[k] = r[c]
      })
      return rec
    })
  } else {
    const text = String(body.text || '').trim()
    if (!text) throw badRequest('贴一段内容或者选一个文件')
    if (text.length > MAX_TEXT) throw badRequest(`一次最多 ${MAX_TEXT} 字，内容多的请用文件导入`)
    const table = splitTable(text)
    const headMap = guessMapping(table[0] || [], fields)
    const looksTable = table.length > 1 && (headMap.includes('name') || headMap.includes('jobNumber')) && headMap.filter(Boolean).length >= 2
    if (aiReady() && !looksTable) {
      try {
        records = (await aiExtract(text, fields, today)).map((r, i) => ({ row: i + 1, ...r }))
        ai.used = true
      } catch (e) {
        throw badRequest(`大模型没能识别这段内容：${e.message}`)
      }
    } else if (looksTable) {
      // 粘贴的表格：和文件一样处理
      return analyze(ctx, { rows: table, year })
    } else {
      throw badRequest('没接入以虎 One 的大模型，只能识别表格：第一行写表头（姓名、入职日期、年假余额……），一行一人')
    }
  }

  // 规则先规范一遍，解析不了的值交给模型
  const emps = await prisma.employee.findMany()
  const cur = await currentValues(emps, fields, year)
  const pass = (recs) => recs.map(rec => {
    const m = matchEmployee(rec, emps)
    const d = diffRecord(rec.values, m.employee ? cur(m.employee) : {}, fields, { today })
    return { rec, m, d }
  })
  let out = pass(records)
  const unparsed = new Map()
  for (const o of out) for (const u of o.d.unparsed) unparsed.set(u.field, (unparsed.get(u.field) || new Set()).add(String(o.rec.values[u.field]).trim()))
  if (unparsed.size) {
    const fixed = await tryAi(() => aiNormalize(unparsed, fields, today), null)
    if (fixed) {
      for (const rec of records) {
        for (const [k, v] of Object.entries(rec.values)) {
          const hit = fixed.get(k)?.get(String(v).trim())
          if (hit != null && hit !== 'null') rec.values[k] = hit
        }
      }
      out = pass(records)
    }
  }

  const byKey = new Map(fields.map(f => [f.key, f]))
  const rows = out.map(({ rec, m, d }) => ({
    row: rec.row, who: { name: rec.name, jobNumber: rec.jobNumber },
    employee: m.employee ? employeeBrief(m.employee) : null, error: m.error || null,
    changes: d.changes.map(c => ({ ...c, fromText: fmtValue(byKey.get(c.field), c.from), toText: fmtValue(byKey.get(c.field), c.to) })),
    unparsed: d.unparsed
  }))
  // 同一个人出现两次：只认第一行
  const seen = new Set()
  for (const r of rows) {
    if (!r.employee) continue
    if (seen.has(r.employee.id)) { r.error = '表里前面已经有这个人了，这一行不导'; r.changes = [] }
    seen.add(r.employee.id)
  }
  return {
    year, ai, columns,
    fields: fields.map(f => ({ key: f.key, label: f.label })),
    rows,
    summary: { rows: rows.length, matched: rows.filter(r => r.employee && !r.error).length, withChanges: rows.filter(r => r.employee && !r.error && r.changes.length).length, unmatched: rows.filter(r => r.error).length }
  }
}

/** 确认导入：items = [{ userId, changes: { field: 规范后的值 } }]，值再校验一遍 */
export async function apply(ctx, { items = [], year } = {}) {
  await requireHr(ctx)
  const s = await getSettings()
  const y = Number(year) || currentYear(s.timezone)
  if (!Array.isArray(items) || !items.length) throw badRequest('没有要导入的')
  if (items.length > MAX_ROWS) throw badRequest(`一次最多导 ${MAX_ROWS} 人`)
  const fields = await allFields()
  const byKey = new Map(fields.map(f => [f.key, f]))
  const today = await todayStr()
  const errors = []
  let people = 0, profileFields = 0, balances = 0
  for (const it of items) {
    const emp = await prisma.employee.findUnique({ where: { id: Number(it.userId) } })
    if (!emp) { errors.push(`没有员工 ${it.userId}`); continue }
    const data = {}
    const bal = []
    for (const [k, v] of Object.entries(it.changes || {})) {
      const f = byKey.get(k)
      if (!f || f.kind === 'who' || f.kind === 'years') continue
      const r = normalizeValue(f, v, { today })
      if (r.error || r.empty) { errors.push(`${emp.name}的${f.label}「${v}」格式不对，没导`); continue }
      if (f.kind === 'balance') bal.push({ typeCode: f.typeCode, value: r.value })
      else if (k === 'exemption') data.exemption = r.value === 'NONE' ? null : r.value
      else data[k] = DATE_KEYS.has(k) ? new Date(r.value + 'T00:00:00Z') : r.value
    }
    if (Object.keys(data).length) await prisma.employee.update({ where: { id: emp.id }, data })
    for (const b of bal) await setBalance(ctx, { userId: emp.id, year: y, typeCode: b.typeCode, value: b.value, note: `智能导入：${y} 年余额设为 ${b.value} 天` })
    if (Object.keys(data).length || bal.length) people++
    profileFields += Object.keys(data).length
    balances += bal.length
  }
  // 留痕只记数量（不记具体的人事信息）
  audit(ctx, 'people.import', { entityType: 'employee', detail: { people, profileFields, balances, year: y } })
  return { people, profileFields, balances, errors: errors.slice(0, 50) }
}

/**
 * AI 助手（MCP）用：直接给结构化的记录（助手从对话里整理好），按同样的规则规范、对人、写入。
 * records：[{ name?, jobNumber?, userId?, values: { field: 值 } }]；preview=true 只返回要改什么
 */
export async function importRecords(ctx, { records = [], year, preview = false } = {}) {
  await requireHr(ctx)
  const s = await getSettings()
  const y = Number(year) || currentYear(s.timezone)
  const today = await todayStr()
  const fields = await allFields()
  const emps = await prisma.employee.findMany()
  const cur = await currentValues(emps, fields, y)
  const rows = records.slice(0, 500).map(rec => {
    const m = rec.userId ? { employee: emps.find(e => e.id === Number(rec.userId)) || null, error: emps.some(e => e.id === Number(rec.userId)) ? null : `没有员工 ${rec.userId}` } : matchEmployee(rec, emps)
    const d = m.employee ? diffRecord(rec.values || {}, cur(m.employee), fields, { today }) : { changes: [], unparsed: [] }
    return { who: rec.name || rec.jobNumber || rec.userId, employee: m.employee ? employeeBrief(m.employee) : null, error: m.error || null, changes: d.changes, unparsed: d.unparsed }
  })
  if (preview) return { year: y, rows }
  const items = rows.filter(r => r.employee && r.changes.length).map(r => ({ userId: r.employee.id, changes: Object.fromEntries(r.changes.map(c => [c.field, c.to])) }))
  const result = items.length ? await apply(ctx, { items, year: y }) : { people: 0, profileFields: 0, balances: 0, errors: [] }
  return { year: y, ...result, rows: rows.map(r => ({ who: r.who, matched: r.employee?.name || null, error: r.error, changes: r.changes.map(c => `${c.label}：${c.from ?? '空'} → ${c.to}`), unparsed: r.unparsed.map(u => `${u.label}「${u.raw}」看不懂`) })) }
}

export const IMPORT_FIELDS_DOC = async () => fieldDoc((await allFields()).filter(f => f.kind !== 'who'))
