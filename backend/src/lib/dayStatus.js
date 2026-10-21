// 一个人一天的考勤状态：三家的打卡结果 + 三家同步来的请假 / 出差 / 外出 + 工作日历合在一起看。纯函数，单元测试覆盖。
//   - 请满一天假 → LEAVE；出差满一天 → TRIP（打卡系统报的缺卡 / 旷工不算）
//   - 请假、出差、外出不满一天 → 时间类异常（迟到、早退、缺卡、旷工）不算，地点异常照算
//   - 某一类（上班 / 下班）有手工补录的，这一类以补录为准
//   - 工作日没有任何记录 → NO_DATA（没排班或没同步到，不当旷工）；还没到的日子 → FUTURE；非工作日没记录 → REST

export const TIME_FLAGS = ['LATE', 'SERIOUS_LATE', 'EARLY', 'MISSING', 'ABSENT']
const FULL = 0.99
const sum = (list, cat) => list.filter(x => !cat || x.category === cat).reduce((s, x) => s + (x.units || 0), 0)

/**
 * leaveTypes：这天的请假 [{ code, name, units }]；away：这天的出差 / 外出 [{ category: 'TRIP' | 'OUT', name, units }]
 * leaveUnits 不给就按 leaveTypes 加起来
 */
export function dayStatus({ punches = [], leaveUnits, leaveTypes = [], away = [], workday = true, future = false }) {
  const leave = leaveUnits ?? sum(leaveTypes)
  const trip = sum(away, 'TRIP')
  const out = sum(away, 'OUT')
  const manualKinds = new Set(punches.filter(p => p.source === 'MANUAL').map(p => p.kind))
  const effective = punches.filter(p => p.source === 'MANUAL' || !manualKinds.has(p.kind))
  const times = (kind) => effective.filter(p => p.kind === kind && p.checkTime).map(p => new Date(p.checkTime).getTime())
  const ins = times('IN'), outs = times('OUT')
  const base = {
    firstIn: ins.length ? new Date(Math.min(...ins)) : null,
    lastOut: outs.length ? new Date(Math.max(...outs)) : null,
    leaveUnits: Math.round(leave * 100) / 100, leaveTypes, away, workday, future, punches: effective.length
  }
  if (leave >= FULL) return { ...base, status: 'LEAVE', flags: [] }
  if (trip >= FULL || trip + leave >= FULL) return { ...base, status: trip >= leave ? 'TRIP' : 'LEAVE', flags: [] }
  if (!effective.length) {
    if (leave > 0) return { ...base, status: 'LEAVE', flags: [] }
    if (trip > 0) return { ...base, status: 'TRIP', flags: [] }
    if (out > 0) return { ...base, status: 'OUT', flags: [] }
    return { ...base, status: !workday ? 'REST' : future ? 'FUTURE' : 'NO_DATA', flags: [] }
  }
  let flags = [...new Set(effective.map(p => p.result).filter(r => r !== 'NORMAL'))]
  if (leave > 0 || trip > 0 || out > 0) flags = flags.filter(f => !TIME_FLAGS.includes(f))
  return { ...base, status: flags.length ? 'ABNORMAL' : 'NORMAL', flags }
}

/** 月度汇总：days = [{ date, ...dayStatus }]。请假按类型名称汇总（各家的假期名称不一定对得上本应用的类型） */
export function summarize(days) {
  // workdays：这个月应出勤的天数；due：到今天为止应出勤、又不是请假 / 出差的天数（算出勤率用）
  const s = { workdays: 0, due: 0, normal: 0, abnormal: 0, noData: 0, late: 0, early: 0, missing: 0, absent: 0, location: 0, leaveDays: 0, tripDays: 0, outDays: 0, leaveByType: {} }
  for (const d of days) {
    if (d.workday) s.workdays++
    if (d.workday && !d.future) s.due += Math.max(0, 1 - d.leaveUnits - sum((d.away || []), 'TRIP'))
    if (d.status === 'NORMAL') s.normal++
    if (d.status === 'ABNORMAL') s.abnormal++
    if (d.status === 'NO_DATA') s.noData++
    if (d.flags.includes('LATE') || d.flags.includes('SERIOUS_LATE')) s.late++
    if (d.flags.includes('EARLY')) s.early++
    if (d.flags.includes('MISSING')) s.missing++
    if (d.flags.includes('ABSENT')) s.absent++
    if (d.flags.includes('LOCATION')) s.location++
    s.leaveDays += d.leaveUnits
    s.tripDays += sum((d.away || []).filter(() => d.workday), 'TRIP')
    if ((d.away || []).some(x => x.category === 'OUT')) s.outDays++
    for (const t of d.leaveTypes) {
      const k = t.name || t.code || '请假'
      s.leaveByType[k] = Math.round(((s.leaveByType[k] || 0) + t.units) * 100) / 100
    }
  }
  s.leaveDays = Math.round(s.leaveDays * 100) / 100
  s.tripDays = Math.round(s.tripDays * 100) / 100
  s.due = Math.round(s.due * 100) / 100
  return s
}
