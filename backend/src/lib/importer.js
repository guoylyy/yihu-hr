// 智能导入的规则部分（纯函数，单元测试覆盖）：表头对字段、各种写法的值规范成本应用的格式、和现有数据比出要改什么。
// 大模型（services/importer.js）只负责「认不出来的」：没对上的表头、规则解析不了的值、一段话里的信息；
// 模型给的结果也要再过一遍这里的规范化，格式不对的不收
import { addDays, isDateStr } from './dates.js'
import { parseExemption } from './exemption.js'

export const EMPLOYMENT_CODES = { FULL_TIME: '全职', INTERN: '实习', PART_TIME: '兼职', OUTSOURCED: '外包', REHIRED: '退休返聘' }
export const EDUCATION_LEVELS = ['高中及以下', '大专', '本科', '硕士', '博士']

/** 能导入的字段（余额字段按「扣余额」的假期类型另加，见 balanceFields） */
export const PROFILE_FIELDS = [
  { key: 'name', label: '姓名', kind: 'who', syn: ['姓名', '员工姓名', '名字', 'name'] },
  { key: 'jobNumber', label: '工号', kind: 'who', syn: ['工号', '员工编号', '员工工号', '员工号', '人员编号', '编号', 'employeeid', 'employeeno'] },
  { key: 'hireDate', label: '入职日期', kind: 'date', syn: ['入职日期', '入职时间', '到岗日期', '入司日期', '入司时间', '加入日期', 'hiredate'] },
  { key: 'workStartDate', label: '参加工作日期', kind: 'date', syn: ['参加工作日期', '参加工作时间', '首次参加工作日期', '首次工作日期', '参工日期', '参工时间', '开始工作日期'] },
  { key: 'regularDate', label: '转正日期', kind: 'date', syn: ['转正日期', '转正时间', '实际转正日期'] },
  { key: 'leaveDate', label: '离职日期', kind: 'date', syn: ['离职日期', '离职时间', '最后工作日'] },
  { key: 'birthDate', label: '出生日期', kind: 'date', syn: ['出生日期', '出生年月', '生日', '出生年月日'] },
  { key: 'gender', label: '性别', kind: 'gender', syn: ['性别', 'gender', 'sex'] },
  { key: 'education', label: '学历', kind: 'education', syn: ['最高学历', '学历', '文化程度'] },
  { key: 'school', label: '毕业院校', kind: 'text', max: 100, syn: ['毕业院校', '毕业学校', '院校', '学校'] },
  { key: 'major', label: '专业', kind: 'text', max: 100, syn: ['所学专业', '专业'] },
  { key: 'level', label: '职级', kind: 'text', max: 20, syn: ['职级', '级别', '职等', '职位级别', 'level'] },
  { key: 'employmentType', label: '用工类型', kind: 'employment', syn: ['用工类型', '用工性质', '员工类型', '人员类型', '雇佣类型', '聘用形式', '员工性质'] },
  { key: 'tags', label: '标签', kind: 'tags', syn: ['标签', '技能', '特长', 'tags'] },
  { key: 'exemption', label: '考勤 / 考核豁免', kind: 'exemption', syn: ['考勤豁免', '免考勤', '是否考勤', '是否打卡', '考勤方式', '考核豁免', '是否考核', '豁免'] },
  { key: 'exemptNote', label: '豁免原因', kind: 'text', max: 100, syn: ['豁免原因', '免考勤原因'] },
  { key: 'workYears', label: '工龄（年）→ 推算参加工作日期', kind: 'years', target: 'workStartDate', syn: ['工龄', '工作年限', '累计工龄'] },
  { key: 'tenureYears', label: '司龄（年）→ 推算入职日期', kind: 'years', target: 'hireDate', syn: ['司龄', '本司工龄', '在职年限'] }
]

export function balanceFields(types) {
  return types.filter(t => t.balanced).map(t => ({
    key: `balance:${t.code}`, label: `${t.name}余额（天）`, kind: 'balance', typeCode: t.code,
    syn: [`${t.name}余额`, `剩余${t.name}`, `${t.name}剩余`, `可用${t.name}`, `${t.name}可用`, `${t.name}天数`, `${t.name}（天）`, `${t.name}(天)`, ...(t.code === 'ANNUAL' ? ['年休假余额', '剩余年休假', '年休假'] : []), t.name]
  }))
}

const norm = (h) => String(h ?? '').toLowerCase().replace(/[\s_\-:：*]/g, '')

/** 表头 → 字段：先完全相同，再包含（取最长的同义词）。返回 [fieldKey | null]，一个字段只给一列 */
export function guessMapping(headers, fields) {
  const out = headers.map(() => null)
  const used = new Set()
  const pass = (fn) => headers.forEach((h, i) => {
    if (out[i]) return
    const n = norm(h)
    if (!n) return
    let best = null
    for (const f of fields) {
      if (used.has(f.key)) continue
      for (const s of f.syn) {
        const ns = norm(s)
        if (fn(n, ns) && (!best || ns.length > best.len)) best = { key: f.key, len: ns.length }
      }
    }
    if (best) { out[i] = best.key; used.add(best.key) }
  })
  pass((n, s) => n === s)
  pass((n, s) => s.length >= 2 && n.includes(s))
  return out
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => {
  const s = `${y}-${pad(m)}-${pad(d)}`
  return isDateStr(s) ? s : null
}

/** 各种写法的日期 → YYYY-MM-DD：2021-3-5、2021/03/05、2021.3.5、2021年3月5日、20210305、2021-03（取 1 号）、3/5/2021、Excel 序列号 */
export function parseDate(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v)
    // Excel 的日期序列号（1900 年体系）：20000 ≈ 1954 年，80000 ≈ 2119 年
    if (n > 20000 && n < 80000) return addDays('1899-12-30', Math.floor(n))
    return null
  }
  const t = String(v).trim().replace(/\s+/g, '')
  let m
  if ((m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?(?:T.*|\d{1,2}:.*)?$/.exec(t))) return ymd(+m[1], +m[2], +m[3])
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) return ymd(+m[1], +m[2], +m[3])
  if ((m = /^(\d{4})[-/.年](\d{1,2})月?$/.exec(t))) return ymd(+m[1], +m[2], 1)
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) {
    const y = m[3].length === 2 ? (Number(m[3]) > 50 ? 1900 : 2000) + Number(m[3]) : Number(m[3])
    return ymd(y, +m[1], +m[2])
  }
  return null
}

export function parseGender(v) {
  const t = String(v ?? '').trim().toLowerCase()
  if (['男', 'm', 'male', '男性'].includes(t)) return 'M'
  if (['女', 'f', 'female', '女性'].includes(t)) return 'F'
  return null
}

export function parseEducation(v) {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (EDUCATION_LEVELS.includes(t)) return t
  if (/博士/.test(t) || /^phd$/i.test(t)) return '博士'
  if (/硕士|研究生|mba|master/i.test(t)) return '硕士'
  if (/本科|学士|bachelor/i.test(t)) return '本科'
  if (/大专|专科|高职/.test(t)) return '大专'
  if (/高中|中专|职高|技校|初中|小学/.test(t)) return '高中及以下'
  return null
}

export function parseEmployment(v) {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (EMPLOYMENT_CODES[t.toUpperCase()]) return t.toUpperCase()
  if (/返聘/.test(t)) return 'REHIRED'
  if (/实习/.test(t)) return 'INTERN'
  if (/兼职|非全日制/.test(t)) return 'PART_TIME'
  if (/外包|派遣|劳务/.test(t)) return 'OUTSOURCED'
  if (/全职|正式|全日制|合同制|在编/.test(t)) return 'FULL_TIME'
  return null
}

/** 「8」「8 年」「8.5年」「8年3个月」→ 年数 */
export function parseYears(v) {
  const t = String(v ?? '').trim()
  let m
  if ((m = /^(\d+(?:\.\d+)?)\s*年?$/.exec(t))) return Number(m[1])
  if ((m = /^(\d+)\s*年\s*(\d+)\s*个?月$/.exec(t))) return Number(m[1]) + Number(m[2]) / 12
  if ((m = /^(\d+)\s*个?月$/.exec(t))) return Number(m[1]) / 12
  return null
}

/** 余额：「5」「5.5 天」→ 天，取到 0.5 */
export function parseBalance(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 365 ? Math.round(v * 2) / 2 : null
  const m = /^(\d+(?:\.\d+)?)\s*天?$/.exec(String(v ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  return n <= 365 ? Math.round(n * 2) / 2 : null
}

/** 年数 → 从 today 往回推的日期（按月取整，取 1 号） */
export function yearsAgo(today, years) {
  const months = Math.round(years * 12)
  const [y, m] = today.split('-').map(Number)
  const total = y * 12 + (m - 1) - months
  return ymd(Math.floor(total / 12), (total % 12) + 1, 1)
}

const EMPTY = /^(|-|—|–|无|\/|n\/a|null|未知|暂无)$/i

/**
 * 一个原始值规范成字段的值。返回 { empty: true } / { value } / { error: true }
 * field.kind：who / date / gender / education / employment / text / tags / years / balance
 */
export function normalizeValue(field, raw, { today } = {}) {
  if (raw == null || (typeof raw === 'string' && EMPTY.test(raw.trim()))) return { empty: true }
  const s = typeof raw === 'string' ? raw.trim() : raw
  let value = null
  switch (field.kind) {
    case 'who': case 'text': value = String(s).slice(0, field.max || 50) || null; break
    case 'date': value = parseDate(s); break
    case 'gender': value = parseGender(s); break
    case 'education': value = parseEducation(s); break
    case 'employment': value = parseEmployment(s); break
    case 'tags': value = (Array.isArray(s) ? s : String(s).split(/[,，、;；/|]+/)).map(x => String(x).trim().slice(0, 20)).filter(Boolean).slice(0, 20); if (!value.length) return { empty: true }; break
    case 'years': { const y = parseYears(s); value = y != null && y < 70 && today ? yearsAgo(today, y) : null; break }
    case 'balance': value = parseBalance(s); break
    case 'exemption': value = parseExemption(s); break
    default: value = null
  }
  return value == null ? { error: true } : { value }
}

const tagsEq = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())

/**
 * 一个人的一组原始值 → 要改的地方。
 * values：{ fieldKey: 原始值 }；current：现在的值 { hireDate: 'YYYY-MM-DD', ..., 'balance:ANNUAL': 3 }
 * 返回 { changes: [{ field, label, from, to, derived? }], unparsed: [{ field, label, raw }] }
 */
export function diffRecord(values, current, fields, { today }) {
  const byKey = new Map(fields.map(f => [f.key, f]))
  const changes = [], unparsed = []
  const given = new Set()
  const plan = []
  for (const [k, raw] of Object.entries(values)) {
    const f = byKey.get(k)
    if (!f || f.kind === 'who') continue
    const r = normalizeValue(f, raw, { today })
    if (r.empty) continue
    if (r.error) { unparsed.push({ field: k, label: f.label, raw: String(raw).slice(0, 100) }); continue }
    const target = f.target || k
    if (!f.target) given.add(target)
    plan.push({ field: target, label: byKey.get(target)?.label || f.label, to: r.value, derived: f.target ? f.label : undefined })
  }
  for (const p of plan) {
    // 工龄推算的日期只在没直接给日期时用
    if (p.derived && given.has(p.field)) continue
    if (changes.some(c => c.field === p.field)) continue
    const from = current[p.field] ?? null
    const same = Array.isArray(p.to) ? tagsEq(from, p.to) : String(from ?? '') === String(p.to)
    if (!same) changes.push({ field: p.field, label: p.label, from, to: p.to, ...(p.derived ? { derived: p.derived } : {}) })
  }
  return { changes, unparsed }
}
