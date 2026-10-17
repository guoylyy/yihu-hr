// 考勤查看：我的月历、团队某一天、月度报表、手工补录
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { dayInTz, eachDay, isDateStr, leaveUnits, monthRange, timeInTz, zonedTime } from '../lib/dates.js'
import { dayStatus, summarize } from '../lib/dayStatus.js'
import { SOURCE_LABEL } from '../providers/index.js'
import { canSee, canSeeTeam, requireHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { workdayFn } from './holidays.js'
import { getSettings } from './settings.js'

/** 已批准的假在 [from, to] 里每人每天占多少：Map(userId -> Map(date -> [{ code, units }])) */
export async function leaveMap(userIds, from, to, isWork) {
  const where = { status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from }, ...(userIds ? { userId: { in: userIds } } : {}) }
  const reqs = await prisma.leaveRequest.findMany({ where })
  const m = new Map()
  for (const r of reqs) {
    for (const u of leaveUnits(r, isWork)) {
      if (u.date < from || u.date > to) continue
      if (!m.has(r.userId)) m.set(r.userId, new Map())
      const byDay = m.get(r.userId)
      byDay.set(u.date, [...(byDay.get(u.date) || []), { code: r.typeCode, units: u.units, requestId: r.id }])
    }
  }
  return m
}

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
  const isWork = await workdayFn()
  const [punches, leaves] = await Promise.all([
    prisma.punch.findMany({ where: { userId: { in: userIds }, workDate: { gte: from, lte: to } }, orderBy: { checkTime: 'asc' } }),
    leaveMap(userIds, from, to, isWork)
  ])
  const byKey = new Map()
  for (const p of punches) {
    const k = `${p.userId}:${p.workDate}`
    byKey.set(k, [...(byKey.get(k) || []), p])
  }
  const out = new Map()
  for (const uid of userIds) {
    out.set(uid, eachDay(from, to).map(date => {
      const ps = byKey.get(`${uid}:${date}`) || []
      const lv = leaves.get(uid)?.get(date) || []
      const st = dayStatus({ punches: ps, leaveUnits: lv.reduce((a, x) => a + x.units, 0), leaveTypes: lv, workday: isWork(date) })
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

/** 某人某月的考勤（默认自己、本月） */
export async function monthOf(ctx, { userId, month } = {}) {
  const uid = Number(userId) || ctx.user.id
  if (!(await canSee(ctx, uid))) throw forbidden('只能看自己和下属的考勤')
  const s = await getSettings()
  const ym = month || dayInTz(new Date(), s.timezone).slice(0, 7)
  const range = monthRange(ym)
  if (!range) throw badRequest('月份格式是 YYYY-MM')
  const days = (await buildDays([uid], ...range)).get(uid)
  const emp = await prisma.employee.findUnique({ where: { id: uid } })
  return { employee: employeeBrief(emp) || { id: uid, name: ctx.user.name }, month: ym, days, summary: summarize(days) }
}

async function teamEmployees(ctx, { deptId, keyword } = {}) {
  if (!(await canSeeTeam(ctx))) throw forbidden('只有部门负责人和人事能看团队考勤')
  const scope = await visibleScope(ctx)
  let emps = await prisma.employee.findMany({ where: { active: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  if (deptId) {
    const root = emps.flatMap(e => e.depts || []).find(d => d.id === Number(deptId))?.path
    emps = emps.filter(e => (e.depts || []).some(d => d.id === Number(deptId) || (root && d.path?.startsWith(root + '/'))))
  }
  if (keyword) emps = emps.filter(e => e.name.includes(keyword) || e.jobNumber?.includes(keyword) || e.deptPath?.includes(keyword))
  return emps
}

/** 团队某一天：每人的上下班时间和状态 */
export async function teamDay(ctx, { date, deptId, keyword } = {}) {
  const s = await getSettings()
  const day = date || dayInTz(new Date(), s.timezone)
  if (!isDateStr(day)) throw badRequest('日期格式是 YYYY-MM-DD')
  const emps = await teamEmployees(ctx, { deptId, keyword })
  const days = await buildDays(emps.map(e => e.id), day, day)
  const rows = emps.map(e => ({ employee: employeeBrief(e), ...days.get(e.id)[0] }))
  const count = (st) => rows.filter(r => r.status === st).length
  return {
    date: day, workday: rows[0]?.workday ?? (await workdayFn())(day), rows,
    stats: { total: rows.length, normal: count('NORMAL'), abnormal: count('ABNORMAL'), leave: count('LEAVE'), noData: count('NO_DATA'), rest: count('REST') }
  }
}

/** 月度报表：每人一行汇总 */
export async function monthlyReport(ctx, { month, deptId, keyword } = {}) {
  const s = await getSettings()
  const ym = month || dayInTz(new Date(), s.timezone).slice(0, 7)
  const range = monthRange(ym)
  if (!range) throw badRequest('月份格式是 YYYY-MM')
  const emps = await teamEmployees(ctx, { deptId, keyword })
  const days = await buildDays(emps.map(e => e.id), ...range)
  return { month: ym, rows: emps.map(e => ({ employee: employeeBrief(e), ...summarize(days.get(e.id)) })) }
}

const csvCell = (v) => {
  const t = String(v ?? '')
  // 防 CSV 公式注入：= + - @ 开头的加单引号
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export async function monthlyReportCsv(ctx, q) {
  const r = await monthlyReport(ctx, q)
  const types = await prisma.leaveType.findMany({ orderBy: { sort: 'asc' } })
  const head = ['姓名', '工号', '部门', '应出勤天数', '正常', '异常', '无记录', '迟到', '早退', '缺卡', '旷工', '地点异常', '请假合计', ...types.map(t => t.name)]
  const lines = [head, ...r.rows.map(x => [
    x.employee.name, x.employee.jobNumber, x.employee.deptPath, x.workdays, x.normal, x.abnormal, x.noData, x.late, x.early, x.missing, x.absent, x.location, x.leaveDays,
    ...types.map(t => x.leaveByType[t.code] || 0)
  ])]
  audit(ctx, 'report.export', { detail: { month: r.month, rows: r.rows.length } })
  return { filename: `考勤月报-${r.month}.csv`, body: '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n') }
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
