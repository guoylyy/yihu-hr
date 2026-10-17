// 合同与协议的纯逻辑：类型、状态、按《劳动合同法》校验期限和试用期、竞业限制期
import { addDays, diffDays, isDateStr } from './dates.js'

export const KINDS = {
  LABOR: '劳动合同',
  CONFIDENTIALITY: '保密协议',
  NON_COMPETE: '竞业限制协议',
  IP: '知识产权归属协议',
  TRAINING: '培训服务期协议',
  INTERN: '实习协议',
  SERVICE: '劳务协议',
  OTHER: '其他'
}
export const TERMS = { FIXED: '固定期限', OPEN: '无固定期限', TASK: '以完成一定工作任务为期限' }
export const STATUS = {
  PENDING: '未生效',
  ACTIVE: '有效',
  EXPIRING: '即将到期',
  EXPIRED: '已到期',
  TERMINATED: '已解除',
  SIGNED: '已签（未启动）',
  IN_FORCE: '履行中'
}

/** 加 n 个月：1/31 + 1 月 = 2/28（月底对齐，和法律上「期满」的算法一致） */
export function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** 合同期限按月算（不足整月的向上取）：用来判断试用期上限 */
export function termMonths(startDate, endDate) {
  let n = 0
  while (addDays(addMonths(startDate, n), -1) < endDate) n++
  return n
}

/** 竞业限制期：离职日起 restrictMonths 个月；没离职或没写期限返回 null */
export function restrictWindow(c, leaveDate) {
  if (c.kind !== 'NON_COMPETE' || !leaveDate || !c.restrictMonths) return null
  return { from: leaveDate, to: addDays(addMonths(leaveDate, c.restrictMonths), -1) }
}

/**
 * 合同当前的状态。竞业限制看离职日：在职时「已签」，离职后在限制期内「履行中」，过了「已到期」
 * warnDays：到期前多少天算「即将到期」
 */
export function contractStatus(c, today, { warnDays = 60, leaveDate = null } = {}) {
  if (c.terminatedAt && c.terminatedAt <= today) return 'TERMINATED'
  if (c.kind === 'NON_COMPETE') {
    const w = restrictWindow(c, leaveDate)
    if (!w) return 'SIGNED'
    return today < w.from ? 'SIGNED' : today <= w.to ? 'IN_FORCE' : 'EXPIRED'
  }
  if (c.startDate > today) return 'PENDING'
  if (!c.endDate) return 'ACTIVE'
  if (c.endDate < today) return 'EXPIRED'
  return diffDays(today, c.endDate) <= warnDays ? 'EXPIRING' : 'ACTIVE'
}

/** 还剩几天到期（无固定期限、竞业限制返回 null） */
export function daysLeft(c, today) {
  return c.kind === 'NON_COMPETE' || !c.endDate ? null : diffDays(today, c.endDate)
}

/**
 * 试用期上限（月）：《劳动合同法》第十九条
 *   不满 3 个月、以完成一定工作任务为期限：不得约定试用期
 *   3 个月以上不满 1 年：1 个月；1 年以上不满 3 年：2 个月；3 年以上或无固定期限：6 个月
 */
export function maxProbationMonths({ term, startDate, endDate }) {
  if (term === 'TASK') return 0
  if (term === 'OPEN') return 6
  const months = termMonths(startDate, endDate)
  if (months < 3) return 0
  if (months < 12) return 1
  if (months < 36) return 2
  return 6
}

/** 校验：errors 不让保存，warnings 提示人事注意 */
export function checkContract(c) {
  const errors = [], warnings = []
  if (!KINDS[c.kind]) errors.push('合同类型不对')
  if (!TERMS[c.term || 'FIXED']) errors.push('期限类型不对')
  if (!isDateStr(c.startDate)) errors.push('生效日期要写 YYYY-MM-DD')
  for (const k of ['endDate', 'signedDate', 'probationEnd', 'terminatedAt']) if (c[k] && !isDateStr(c[k])) errors.push(`${k} 要写 YYYY-MM-DD`)
  if (errors.length) return { errors, warnings }
  const term = c.term || 'FIXED'
  if (c.kind !== 'NON_COMPETE') {
    if (term === 'FIXED' && !c.endDate) errors.push('固定期限的合同要写到期日')
    if (term === 'OPEN' && c.endDate) errors.push('无固定期限的合同不写到期日')
    if (c.endDate && c.endDate < c.startDate) errors.push('到期日早于生效日')
  }
  if (c.terminatedAt && c.terminatedAt < c.startDate) errors.push('解除日期早于生效日')
  if (c.probationEnd) {
    if (c.kind !== 'LABOR') errors.push('只有劳动合同能约定试用期')
    else if (c.probationEnd < c.startDate) errors.push('试用期截止日早于生效日')
    else if (term === 'FIXED' && !c.endDate) { /* 上面已报 */ } else {
      const max = maxProbationMonths({ term, startDate: c.startDate, endDate: c.endDate })
      if (max === 0) errors.push(term === 'TASK' ? '以完成一定工作任务为期限的合同不得约定试用期' : '合同期限不满 3 个月，不得约定试用期')
      else if (c.probationEnd > addDays(addMonths(c.startDate, max), -1)) errors.push(`这份合同的试用期最长 ${max} 个月（劳动合同法第十九条），最晚到 ${addDays(addMonths(c.startDate, max), -1)}`)
    }
  }
  if (c.kind === 'NON_COMPETE') {
    const m = Number(c.restrictMonths)
    if (!Number.isInteger(m) || m < 1 || m > 24) errors.push('竞业限制期限要在 1 ~ 24 个月之间（劳动合同法第二十四条）')
    if (!(Number(c.monthlyComp) > 0)) warnings.push('没有约定每月补偿金：离职后要启动竞业限制，需要按月支付补偿（一般不低于离职前 12 个月平均工资的 30%）')
  }
  if (c.kind === 'TRAINING' && !(Number(c.serviceMonths) > 0)) warnings.push('培训服务期协议最好写明服务期')
  return { errors, warnings }
}
