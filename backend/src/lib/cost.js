// 人员成本的纯逻辑：类别、按标准生成某月成本、汇总
import { monthRange } from './dates.js'
import { restrictWindow } from './contracts.js'

export const CATEGORIES = {
  SALARY: '工资',
  BONUS: '奖金',
  SOCIAL: '社保（单位）',
  HOUSING: '公积金（单位）',
  BENEFIT: '福利',
  TRAINING: '培训',
  EQUIPMENT: '设备办公',
  RECRUIT: '招聘',
  NON_COMPETE: '竞业补偿',
  SEVERANCE: '经济补偿',
  OTHER: '其他'
}
/** 标准成本里的四项，对应成本表的类别 */
export const PROFILE_FIELDS = { salary: 'SALARY', social: 'SOCIAL', housing: 'HOUSING', benefit: 'BENEFIT' }

export const money = (v) => Math.round(Number(v || 0) * 100) / 100
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null)

/** 这个月有没有在职（入职不晚于月底，离职不早于月初） */
export function employedIn(emp, month) {
  const [from, to] = monthRange(month)
  const hire = ymd(emp.hireDate), leave = ymd(emp.leaveDate)
  return (!hire || hire <= to) && (!leave || leave >= from)
}

/**
 * 按标准成本和竞业协议生成某月要补的成本行。已经有的（不管怎么来的）不动
 *   employees: [{ id, hireDate, leaveDate, active }]；profiles: Map(userId → { salary, social, housing, benefit })
 *   contracts: 竞业限制协议；existing: Set('userId:category')
 */
export function generateMonth({ month, employees, profiles, contracts, existing }) {
  const out = []
  const [from, to] = monthRange(month)
  const has = (uid, cat) => existing.has(`${uid}:${cat}`)
  for (const e of employees) {
    const p = profiles.get(e.id)
    if (!p || !employedIn(e, month)) continue
    for (const [field, cat] of Object.entries(PROFILE_FIELDS)) {
      const amount = money(p[field])
      if (amount > 0 && !has(e.id, cat)) out.push({ userId: e.id, month, category: cat, amount, source: 'PROFILE' })
    }
  }
  const leaveOf = new Map(employees.map(e => [e.id, ymd(e.leaveDate)]))
  for (const c of contracts) {
    const w = restrictWindow(c, leaveOf.get(c.userId))
    if (!w || w.to < from || w.from > to || c.terminatedAt || !(Number(c.monthlyComp) > 0)) continue
    if (has(c.userId, 'NON_COMPETE') || out.some(x => x.userId === c.userId && x.category === 'NON_COMPETE')) continue
    out.push({ userId: c.userId, month, category: 'NON_COMPETE', amount: money(c.monthlyComp), source: 'CONTRACT', note: `竞业限制补偿（${w.from} ~ ${w.to}）` })
  }
  return out
}

/** 汇总：总额、按类别、按人、按月 */
export function summarize(items) {
  const total = { amount: 0, byCategory: {}, byUser: new Map(), byMonth: {} }
  for (const it of items) {
    const a = money(it.amount)
    total.amount = money(total.amount + a)
    total.byCategory[it.category] = money((total.byCategory[it.category] || 0) + a)
    total.byMonth[it.month] = money((total.byMonth[it.month] || 0) + a)
    total.byUser.set(it.userId, money((total.byUser.get(it.userId) || 0) + a))
  }
  return total
}

/** 前 n 个月（含本月），从早到晚：['2026-05', …, '2026-10'] */
export function lastMonths(month, n) {
  const [y, m] = month.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - (n - 1 - i)
    return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`
  })
}
