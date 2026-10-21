// 考勤查看：个人月历（日历 + 原始记录）、团队某一天、团队月度矩阵、导出、手工补录
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { dayInTz, eachDay, isDateStr, monthRange, timeInTz, weekday, zonedTime } from '../lib/dates.js'
import { dayStatus, summarize } from '../lib/dayStatus.js'
import { SOURCE_LABEL } from '../providers/index.js'
import { canSee, canSeeTeam, requireHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { absenceDto, absenceMap, unitOpts } from './absences.js'
import { getSettings } from './settings.js'
import { attendanceExempt } from '../lib/exemption.js'

function punchDto(p, tz) {
  return {
    id: p.id, source: p.source, sourceLabel: SOURCE_LABEL[p.source], kind: p.kind, result: p.result,
    time: p.checkTime ? timeInTz(p.checkTime, tz) : null, planTime: p.planTime ? timeInTz(p.planTime, tz) : null,
    checkTime: p.checkTime, location: p.location, note: p.note
  }
}

/** 一批人在 [from, to] 每天的状态：Map(userId -> [{ date, ... }]) */
async function buildDays(userIds, from, to) {
  const s = await getSettings()
  const opts = await unitOpts()
  const isWork = opts.isWork
  const [punches, absences] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: userIds }, workDate: { gte: from, lte: to } }, orderBy: { checkTime: 'asc' } }),
    absenceMap(userIds, from, to, opts)
  ])
  const byKey = new Map()
  for (const p of punches) {
    const k = `${p.userId}:${p.workDate}`
    byKey.set(k, [...(byKey.get(k) || []), p])
  }
  const today = dayInTz(new Date(), s.timezone)
  const out = new Map()
  for (const uid of userIds) {
    out.set(uid, eachDay(from, to).map(date => {
      const ps = byKey.get(`${uid}:${date}`) || []
      const ab = absences.get(uid)?.get(date) || { leave: [], away: [] }
      const st = dayStatus({ punches: ps, leaveTypes: ab.leave, away: ab.away, workday: isWork(date), future: date > today })
      return {
        date, ...st,
        firstIn: st.firstIn ? timeInTz(st.firstIn, s.timezone) : null,
        lastOut: st.lastOut ? timeInTz(st.lastOut, s.timezone) : null,
        records: ps.map(p => punchDto(p, s.timezone))
      }
    }))
  }
  return out
}

/** 某人某月的考勤（默认自己、本月）：每天的状态和打卡（日历用），加上这个月的请假 / 出差 / 外出原始记录 */
export async function monthOf(ctx, { userId, month } = {}) {
  const uid = Number(userId) || ctx.user.id
  if (!(await canSee(ctx, uid))) throw forbidden('只能看自己和下属的考勤')
  const s = await getSettings()
  const ym = month || dayInTz(new Date(), s.timezone).slice(0, 7)
  const range = monthRange(ym)
  if (!range) throw badRequest('月份格式是 YYYY-MM')
  const opts = await unitOpts()
  const [days, emp, abs] = await Promise.all([
    buildDays([uid], ...range).then(m => m.get(uid)),
    prisma.employee.findUnique({ where: { id: uid } }),
    prisma.absence.findMany({ where: { userId: uid, status: 'APPROVED', startDate: { lte: range[1] }, endDate: { gte: range[0] } }, orderBy: { startDate: 'asc' } })
  ])
  return {
    employee: employeeBrief(emp) || { id: uid, name: ctx.user.name }, exemptNote: emp?.exemptNote || null, month: ym, today: dayInTz(new Date(), s.timezone),
    days, summary: summarize(days), absences: abs.map(a => absenceDto(a, opts))
  }
}

const csvCell = (v) => {
  const t = String(v ?? '')
  // 防 CSV 公式注入：= + - @ 开头的加单引号
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}
const csv = (lines) => '\ufeff' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')

/** 某人某月的原始记录导出：每一条打卡，和每一条请假 / 出差 / 外出 */
export async function monthRecordsCsv(ctx, q) {
  const r = await monthOf(ctx, q)
  const KIND = { IN: '上班', OUT: '下班', OUTSIDE: '外出' }
  const RESULT = { NORMAL: '正常', LATE: '迟到', SERIOUS_LATE: '严重迟到', EARLY: '早退', MISSING: '缺卡', ABSENT: '旷工', LOCATION: '地点异常', OTHER: '其他' }
  const lines = [['日期', '星期', '类别', '类型', '时间', '应打卡', '结果', '时长（天）', '来源', '地点 / 说明']]
  for (const d of r.days) {
    for (const p of d.records) lines.push([d.date, '日一二三四五六'[weekday(d.date)], '打卡', KIND[p.kind] || p.kind, p.time || '', p.planTime || '', RESULT[p.result] || p.result, '', p.sourceLabel, [p.location, p.note].filter(Boolean).join('；')])
  }
  const tz = (await getSettings()).timezone
  const t = (x) => (x ? `${dayInTz(new Date(x), tz)} ${timeInTz(new Date(x), tz)}` : '')
  for (const a of r.absences) {
    lines.push([a.startDate === a.endDate ? a.startDate : `${a.startDate} ~ ${a.endDate}`, '', a.categoryLabel, a.typeName || '', [t(a.startAt), t(a.endAt)].filter(Boolean).join(' ~ '), '', '已通过', a.workDays, a.sourceLabel, ''])
  }
  audit(ctx, 'records.export', { entityType: 'employee', entityId: r.employee.id, detail: { month: r.month } })
  return { filename: `考勤记录-${r.employee.name}-${r.month}.csv`, body: csv(lines) }
}

/** 能看的团队成员。includeExempt：连免考勤的人也要（默认不要，免得拉低出勤率） */
async function teamEmployees(ctx, { deptId, keyword, includeExempt = false } = {}) {
  if (!(await canSeeTeam(ctx))) throw forbidden('只有部门负责人和人事能看团队考勤')
  const scope = await visibleScope(ctx)
  let emps = await prisma.employee.findMany({ where: { active: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  if (deptId) {
    const root = emps.flatMap(e => e.depts || []).find(d => d.id === Number(deptId))?.path
    emps = emps.filter(e => (e.depts || []).some(d => d.id === Number(deptId) || (root && d.path?.startsWith(root + '/'))))
  }
  if (keyword) emps = emps.filter(e => e.name.includes(keyword) || e.jobNumber?.includes(keyword) || e.deptPath?.includes(keyword))
  return includeExempt ? emps : emps.filter(e => !attendanceExempt(e))
}

/** 团队某一天：每人的上下班时间和状态（AI 助手、老板简报用） */
export async function teamDay(ctx, { date, deptId, keyword } = {}) {
  const s = await getSettings()
  const day = date || dayInTz(new Date(), s.timezone)
  if (!isDateStr(day)) throw badRequest('日期格式是 YYYY-MM-DD')
  const emps = await teamEmployees(ctx, { deptId, keyword })
  const days = await buildDays(emps.map(e => e.id), day, day)
  const rows = emps.map(e => ({ employee: employeeBrief(e), ...days.get(e.id)[0] }))
  const count = (st) => rows.filter(r => r.status === st).length
  return {
    date: day, workday: rows[0]?.workday ?? (await unitOpts()).isWork(day), rows,
    stats: { total: rows.length, normal: count('NORMAL'), abnormal: count('ABNORMAL'), leave: count('LEAVE'), trip: count('TRIP'), out: count('OUT'), noData: count('NO_DATA'), rest: count('REST') }
  }
}

/**
 * 团队月度：每人一行，每天一格（状态、异常、上下班时间、请假 / 出差 / 外出），后面是这个月的汇总。
 * 团队考勤页的矩阵和导出都用它。免考勤的人默认不列；includeExempt=1 时列在最后（exempt: true），也不算进合计
 */
export async function monthlyReport(ctx, { month, deptId, keyword, includeExempt } = {}) {
  const s = await getSettings()
  const ym = month || dayInTz(new Date(), s.timezone).slice(0, 7)
  const range = monthRange(ym)
  if (!range) throw badRequest('月份格式是 YYYY-MM')
  const withExempt = includeExempt === true || includeExempt === '1' || includeExempt === 'true'
  const all = await teamEmployees(ctx, { deptId, keyword, includeExempt: true })
  const exemptCount = all.filter(attendanceExempt).length
  const emps = withExempt ? [...all.filter(e => !attendanceExempt(e)), ...all.filter(attendanceExempt)] : all.filter(e => !attendanceExempt(e))
  const { isWork } = await unitOpts()
  const days = await buildDays(emps.map(e => e.id), ...range)
  const rows = emps.map(e => {
    const ds = days.get(e.id)
    return {
      employee: employeeBrief(e), exempt: attendanceExempt(e), ...summarize(ds),
      cells: ds.map(d => ({
        status: d.status, flags: d.flags, firstIn: d.firstIn, lastOut: d.lastOut,
        leave: d.leaveTypes.map(l => ({ name: l.name, units: l.units })), away: d.away.map(x => ({ category: x.category, name: x.name }))
      }))
    }
  })
  const counted = rows.filter(r => !r.exempt)
  const total = (k) => Math.round(counted.reduce((a, r) => a + r[k], 0) * 100) / 100
  const workdays = eachDay(...range).filter(isWork).length
  return {
    month: ym, today: dayInTz(new Date(), s.timezone), exemptCount,
    days: eachDay(...range).map(d => ({ date: d, workday: isWork(d), weekday: weekday(d) })),
    rows,
    totals: {
      people: counted.length, workdays, normal: total('normal'), abnormal: total('abnormal'), late: total('late'), early: total('early'), missing: total('missing'),
      absent: total('absent'), noData: total('noData'), leaveDays: total('leaveDays'), tripDays: total('tripDays'),
      // 正常出勤率：正常的人天 / 到今天为止应出勤的人天（请假、出差的从分母里去掉）
      normalRate: total('due') ? Math.min(100, Math.round(total('normal') / total('due') * 1000) / 10) : null
    }
  }
}

export async function monthlyReportCsv(ctx, q) {
  const r = await monthlyReport(ctx, q)
  // 各家的假期名称不一定和本应用一样：按这个月实际出现的名称出列
  const names = [...new Set(r.rows.flatMap(x => Object.keys(x.leaveByType)))]
  const head = ['姓名', '工号', '部门', '免考勤', '应出勤天数', '正常', '异常', '无记录', '迟到', '早退', '缺卡', '旷工', '地点异常', '请假合计', ...names, '出差（天）', '外出（天）']
  const lines = [head, ...r.rows.map(x => [
    x.employee.name, x.employee.jobNumber, x.employee.deptPath, x.exempt ? '是' : '', x.workdays, x.normal, x.abnormal, x.noData, x.late, x.early, x.missing, x.absent, x.location, x.leaveDays,
    ...names.map(n => x.leaveByType[n] || 0), x.tripDays, x.outDays
  ])]
  audit(ctx, 'report.export', { detail: { month: r.month, rows: r.rows.length } })
  return { filename: `考勤月报-${r.month}.csv`, body: csv(lines) }
}

/** 人事手工补录一条打卡（补卡）：这一天这一类以补录为准 */
export async function addManualPunch(ctx, { userId, date, time, kind, note }) {
  await requireHr(ctx)
  const s = await getSettings()
  const emp = await prisma.employee.findUnique({ where: { id: Number(userId) } })
  if (!emp) throw notFound('没有这个员工')
  if (!['IN', 'OUT'].includes(kind)) throw badRequest('类型是上班（IN）或下班（OUT）')
  const at = zonedTime(date, time, s.timezone)
  if (!at) throw badRequest('日期 YYYY-MM-DD、时间 HH:mm')
  if (!String(note || '').trim()) throw badRequest('写一下补录原因')
  const p = await prisma.punch.create({
    data: { source: 'MANUAL', externalId: `${emp.id}:${date}:${kind}:${Date.now()}`, userId: emp.id, workDate: date, kind, checkTime: at, result: 'NORMAL', note: String(note).slice(0, 500), createdBy: ctx.user.id }
  })
  audit(ctx, 'punch.manual', { entityType: 'punch', entityId: p.id, detail: { userId: emp.id, date, kind } })
  return punchDto(p, s.timezone)
}

export async function deleteManualPunch(ctx, id) {
  await requireHr(ctx)
  const p = await prisma.punch.findUnique({ where: { id: Number(id) } })
  if (!p) throw notFound('没有这条记录')
  if (p.source !== 'MANUAL') throw badRequest('只能删手工补录的记录；同步来的以打卡系统为准')
  await prisma.punch.delete({ where: { id: p.id } })
  audit(ctx, 'punch.delete', { entityType: 'punch', entityId: p.id, detail: { userId: p.userId, date: p.workDate, kind: p.kind } })
  return { ok: true }
}
