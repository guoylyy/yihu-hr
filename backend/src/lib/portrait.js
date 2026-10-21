// 员工画像的纯逻辑：司龄、年龄、分布，以及要人事 / 负责人留意的事（标记）
import { diffDays } from './dates.js'
import { KINDS, contractStatus, daysLeft, restrictWindow } from './contracts.js'
import { FULL_SKIP_FLAGS, attendanceExempt, evaluationExempt } from './exemption.js'

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null)

/** 整年数（司龄、年龄、工龄都按这个算） */
export function yearsBetween(from, to) {
  if (!from) return null
  const [fy, fm, fd] = ymd(from).split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0)
}

/** 司龄（年，保留 1 位小数） */
export function tenure(hireDate, today) {
  if (!hireDate) return null
  return Math.max(0, Math.round(diffDays(ymd(hireDate), today) / 365.25 * 10) / 10)
}

export const TENURE_BUCKETS = [['<1', '不满 1 年', 0, 1], ['1-3', '1 ~ 3 年', 1, 3], ['3-5', '3 ~ 5 年', 3, 5], ['5-10', '5 ~ 10 年', 5, 10], ['10+', '10 年以上', 10, Infinity]]
export function tenureBucket(years) {
  if (years == null) return 'unknown'
  return TENURE_BUCKETS.find(([, , lo, hi]) => years >= lo && years < hi)[0]
}

export const LEVELS = { risk: 3, warn: 2, info: 1 }

/**
 * 要留意的事。contracts 是这个人没删的合同；last1v1 是最近一次 1v1；abnormalDays 是近 30 天考勤异常天数
 * settings: { contractWarnDays, oneOnOneCadenceDays }
 * 免考勤的人不报考勤异常；不参与考核的人不报考核类的提醒（见 lib/exemption.js）
 */
export function flagsFor({ employee, contracts = [], last1v1 = null, openActions = 0, abnormalDays = 0, today, settings, isLeader = false }) {
  const flags = []
  const leaveDate = ymd(employee.leaveDate)
  const left = !employee.active || (leaveDate && leaveDate < today)
  const st = (c) => contractStatus(c, today, { warnDays: settings.contractWarnDays, leaveDate })
  if (!left) {
    const labor = contracts.filter(c => c.kind === 'LABOR')
    const valid = labor.filter(c => ['ACTIVE', 'EXPIRING', 'PENDING'].includes(st(c)))
    if (!valid.length) flags.push({ code: 'NO_LABOR', level: 'risk', text: labor.length ? '劳动合同已到期 / 解除，没有续签' : '没有劳动合同记录' })
    for (const c of valid.filter(c => st(c) === 'EXPIRING')) {
      // 已经续签（有更晚生效的劳动合同）就不提醒
      if (labor.some(x => x.id !== c.id && x.startDate > c.startDate)) continue
      flags.push({ code: 'LABOR_EXPIRING', level: 'warn', text: `劳动合同 ${daysLeft(c, today)} 天后到期（${c.endDate}）` })
    }
    for (const c of valid) {
      if (c.probationEnd && c.probationEnd >= today && diffDays(today, c.probationEnd) <= 14) flags.push({ code: 'PROBATION_ENDING', level: 'info', text: `试用期 ${c.probationEnd} 截止，要安排转正评估` })
    }
    if (!contracts.some(c => c.kind === 'CONFIDENTIALITY' && st(c) !== 'TERMINATED')) flags.push({ code: 'NO_CONFIDENTIALITY', level: 'info', text: '没有保密协议' })
    const cadence = settings.oneOnOneCadenceDays
    if (cadence > 0) {
      if (!last1v1) flags.push({ code: 'NO_1V1', level: 'warn', text: '还没有 1v1 记录' })
      else if (diffDays(last1v1.date, today) > cadence) flags.push({ code: 'NO_1V1', level: 'warn', text: `${diffDays(last1v1.date, today)} 天没有 1v1（上次 ${last1v1.date}）` })
    }
    if (last1v1?.mood != null && last1v1.mood <= 2) flags.push({ code: 'LOW_MOOD', level: 'warn', text: `最近一次 1v1 状态偏低（${last1v1.mood} / 5）` })
    if (openActions > 0) flags.push({ code: 'OPEN_ACTIONS', level: 'info', text: `${openActions} 项 1v1 待办没完成` })
    if (abnormalDays >= 3) flags.push({ code: 'ATTENDANCE', level: 'warn', text: `近 30 天考勤异常 ${abnormalDays} 天` })
  }
  for (const c of contracts.filter(c => c.kind === 'NON_COMPETE' && st(c) === 'IN_FORCE')) {
    flags.push({ code: 'NC_IN_FORCE', level: 'info', text: `竞业限制履行中，到 ${restrictWindow(c, leaveDate).to}，要按月付补偿` })
  }
  const skip = evaluationExempt(employee) ? FULL_SKIP_FLAGS : attendanceExempt(employee) ? ['ATTENDANCE'] : []
  return flags.filter(f => !skip.includes(f.code)).sort((a, b) => LEVELS[b.level] - LEVELS[a.level])
}

export const kindLabel = (k) => KINDS[k] || k
