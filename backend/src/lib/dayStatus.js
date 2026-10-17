// 一个人一天的考勤状态：三家打卡结果 + 本应用的请假 + 工作日历合在一起看。纯函数，单元测试覆盖。
//   - 请满一天假 → LEAVE（打卡系统不知道这边批的假，会报缺卡 / 旷工，以请假为准）
//   - 请半天假 → 时间类异常（迟到、早退、缺卡、旷工）不算，地点异常照算
//   - 某一类（上班 / 下班）有手工补录的，这一类以补录为准
//   - 工作日没有任何记录 → NO_DATA（没排班或没同步到，不当旷工）；非工作日没记录 → REST

export const TIME_FLAGS = ['LATE', 'SERIOUS_LATE', 'EARLY', 'MISSING', 'ABSENT']

export function dayStatus({ punches = [], leaveUnits = 0, leaveTypes = [], workday = true }) {
  const manualKinds = new Set(punches.filter(p => p.source === 'MANUAL').map(p => p.kind))
  const effective = punches.filter(p => p.source === 'MANUAL' || !manualKinds.has(p.kind))
  const times = (kind) => effective.filter(p => p.kind === kind && p.checkTime).map(p => new Date(p.checkTime).getTime())
  const ins = times('IN'), outs = times('OUT')
  const base = {
    firstIn: ins.length ? new Date(Math.min(...ins)) : null,
    lastOut: outs.length ? new Date(Math.max(...outs)) : null,
    leaveUnits, leaveTypes, workday, punches: effective.length
  }
  if (leaveUnits >= 1) return { ...base, status: 'LEAVE', flags: [] }
  if (!effective.length) {
    if (leaveUnits > 0) return { ...base, status: 'LEAVE', flags: [] }
    return { ...base, status: workday ? 'NO_DATA' : 'REST', flags: [] }
  }
  let flags = [...new Set(effective.map(p => p.result).filter(r => r !== 'NORMAL'))]
  if (leaveUnits > 0) flags = flags.filter(f => !TIME_FLAGS.includes(f))
  return { ...base, status: flags.length ? 'ABNORMAL' : 'NORMAL', flags }
}

/** 月度汇总：days = [{ date, ...dayStatus }] */
export function summarize(days) {
  const s = { workdays: 0, normal: 0, abnormal: 0, noData: 0, late: 0, early: 0, missing: 0, absent: 0, location: 0, leaveDays: 0, leaveByType: {} }
  for (const d of days) {
    if (d.workday) s.workdays++
    if (d.status === 'NORMAL') s.normal++
    if (d.status === 'ABNORMAL') s.abnormal++
    if (d.status === 'NO_DATA') s.noData++
    if (d.flags.includes('LATE') || d.flags.includes('SERIOUS_LATE')) s.late++
    if (d.flags.includes('EARLY')) s.early++
    if (d.flags.includes('MISSING')) s.missing++
    if (d.flags.includes('ABSENT')) s.absent++
    if (d.flags.includes('LOCATION')) s.location++
    s.leaveDays += d.leaveUnits
    for (const t of d.leaveTypes) s.leaveByType[t.code] = (s.leaveByType[t.code] || 0) + t.units
  }
  return s
}
