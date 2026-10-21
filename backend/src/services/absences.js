// 请假 / 出差 / 外出：从钉钉、飞书、企业微信同步来的已通过的假勤（只读），本应用不审批。
//   - 落到每天占多少：lib/absence.js（按设置里的上班时段、每天几小时）
//   - 对上「扣余额」的假期类型（按名称）时自动扣余额；撤销了（重拉时各家已经没有）就退回。
//     按记录对账：这条记录在流水里的扣减之和 = 它应扣的天数，差多少补一条，重复同步不会重复扣
//   - 旧版在本应用里批的请假（LeaveRequest，已批准的）照常算进考勤
import { prisma } from '../lib/prisma.js'
import { forbidden } from '../lib/http.js'
import { absenceUnits, CATEGORY_LABEL, matchType, reportedDays } from '../lib/absence.js'
import { isDateStr, leaveUnits, timeInTz } from '../lib/dates.js'
import { SOURCE_LABEL } from '../providers/index.js'
import { canSee, canSeeTeam, visibleScope } from './access.js'
import { workdayFn } from './holidays.js'
import { getSettings } from './settings.js'

const round2 = (n) => Math.round(n * 100) / 100

/** 落到每天的换算参数（设置 + 工作日历） */
export async function unitOpts() {
  const s = await getSettings()
  return { tz: s.timezone, isWork: await workdayFn(), workStart: s.workStart, workEnd: s.workEnd, hoursPerDay: s.hoursPerDay }
}

/** 这条记录按年应扣的余额天数：{ 2026: 1.5 }（只有对上扣余额的类型、已通过的才扣） */
function deductByYear(a, balanced, opts) {
  if (a.status !== 'APPROVED' || a.category !== 'LEAVE' || !a.typeCode || !balanced.has(a.typeCode)) return {}
  const out = {}
  for (const u of absenceUnits(a, opts)) {
    if (!u.units) continue
    const y = Number(u.date.slice(0, 4))
    out[y] = round2((out[y] || 0) + u.units)
  }
  return out
}

/** 在事务里对一条记录的余额流水：应扣多少和已扣多少的差补一条 USE / RESTORE */
async function reconcileLedger(tx, a, balanced, opts) {
  const want = deductByYear(a, balanced, opts)
  const had = await tx.leaveLedger.groupBy({ by: ['year', 'typeCode'], where: { absenceId: a.id }, _sum: { delta: true } })
  const keys = new Map()
  for (const h of had) keys.set(`${h.year}:${h.typeCode}`, { year: h.year, typeCode: h.typeCode, now: Number(h._sum.delta || 0), want: 0 })
  for (const [y, n] of Object.entries(want)) {
    const k = `${y}:${a.typeCode}`
    keys.set(k, { ...(keys.get(k) || { year: Number(y), typeCode: a.typeCode, now: 0 }), want: -n })
  }
  const label = `${SOURCE_LABEL[a.source] || a.source}${a.typeName || '请假'} ${a.startDate}${a.endDate !== a.startDate ? ` ~ ${a.endDate}` : ''}`
  for (const k of keys.values()) {
    const delta = round2(k.want - k.now)
    if (!delta) continue
    await tx.leaveLedger.create({
      data: { userId: a.userId, year: k.year, typeCode: k.typeCode, delta, kind: delta < 0 ? 'USE' : 'RESTORE', absenceId: a.id, note: delta < 0 ? label : `${label}（已撤销或时长变了）` }
    })
  }
}

/** 存一批同步来的记录（userId 已经补好）。返回保存的条数 */
export async function saveAbsences(list) {
  if (!list.length) return 0
  const types = await prisma.leaveType.findMany()
  const balanced = new Set(types.filter(t => t.balanced).map(t => t.code))
  const opts = await unitOpts()
  let saved = 0
  for (const x of list) {
    const { vendorUserId, ...data } = x
    data.typeCode = data.category === 'LEAVE' ? matchType(data.typeName, types) : null
    data.status = 'APPROVED'
    await prisma.$transaction(async (tx) => {
      // 扣余额和记录变化一起做，同一个人串行
      await tx.$queryRaw`SELECT id FROM Employee WHERE id = ${data.userId} FOR UPDATE`
      const a = await tx.absence.upsert({
        where: { source_externalId: { source: data.source, externalId: data.externalId } },
        create: data,
        update: data
      })
      await reconcileLedger(tx, a, balanced, opts)
    })
    saved++
  }
  return saved
}

/**
 * 重拉 [from, to] 后，这批人在这段时间里本来有、这次各家没给的记录 = 撤销了：标 CANCELLED，退回余额。
 * 只在这批人这段时间都拉成功后调用
 */
export async function cancelMissing(source, userIds, from, to, seenIds) {
  const stale = await prisma.absence.findMany({
    where: { source, userId: { in: userIds }, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from }, externalId: { notIn: seenIds.length ? seenIds : ['-'] } }
  })
  if (!stale.length) return 0
  const types = await prisma.leaveType.findMany({ where: { balanced: true } })
  const balanced = new Set(types.map(t => t.code))
  const opts = await unitOpts()
  for (const a of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Employee WHERE id = ${a.userId} FOR UPDATE`
      const u = await tx.absence.update({ where: { id: a.id }, data: { status: 'CANCELLED' } })
      await reconcileLedger(tx, u, balanced, opts)
    })
  }
  return stale.length
}

/**
 * 一批人在 [from, to] 每人每天的请假和出差 / 外出：
 * Map(userId -> Map(date -> { leave: [{ code, name, units, absenceId, source }], away: [{ category, name, units, absenceId, source }] }))
 */
export async function absenceMap(userIds, from, to, opts) {
  opts = opts || await unitOpts()
  const types = await prisma.leaveType.findMany()
  const typeName = new Map(types.map(t => [t.code, t.name]))
  const [rows, legacy] = await Promise.all([
    prisma.absence.findMany({ where: { status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from }, ...(userIds ? { userId: { in: userIds } } : {}) } }),
    prisma.leaveRequest.findMany({ where: { status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from }, ...(userIds ? { userId: { in: userIds } } : {}) } })
  ])
  const m = new Map()
  const slot = (uid, date) => {
    if (!m.has(uid)) m.set(uid, new Map())
    const byDay = m.get(uid)
    if (!byDay.has(date)) byDay.set(date, { leave: [], away: [] })
    return byDay.get(date)
  }
  for (const a of rows) {
    for (const u of absenceUnits(a, opts)) {
      if (u.date < from || u.date > to) continue
      const item = { name: a.typeName || (a.typeCode ? typeName.get(a.typeCode) : null) || CATEGORY_LABEL[a.category], units: u.units, absenceId: a.id, source: a.source }
      if (a.category === 'LEAVE') {
        if (u.units > 0) slot(a.userId, u.date).leave.push({ code: a.typeCode, ...item })
      } else slot(a.userId, u.date).away.push({ category: a.category, ...item })
    }
  }
  for (const r of legacy) {
    for (const u of leaveUnits(r, opts.isWork)) {
      if (u.date < from || u.date > to) continue
      slot(r.userId, u.date).leave.push({ code: r.typeCode, name: typeName.get(r.typeCode) || r.typeCode, units: u.units, requestId: r.id, source: 'APP' })
    }
  }
  return m
}

export function absenceDto(a, opts) {
  const units = absenceUnits(a, opts)
  return {
    id: a.id, source: a.source, sourceLabel: SOURCE_LABEL[a.source] || a.source, category: a.category, categoryLabel: CATEGORY_LABEL[a.category],
    typeName: a.typeName, typeCode: a.typeCode, startAt: a.startAt, endAt: a.endAt, startDate: a.startDate, endDate: a.endDate,
    // 起止时刻按设置的时区（HH:mm），企业微信按天给的没有
    startTime: a.startAt ? timeInTz(a.startAt, opts.tz) : null, endTime: a.endAt ? timeInTz(a.endAt, opts.tz) : null,
    reportedDays: reportedDays(a, opts.hoursPerDay), hours: a.hours != null ? Number(a.hours) : null,
    // 落在工作日的天数（考勤、余额都按它算）
    workDays: round2(units.reduce((s, u) => s + u.units, 0)),
    status: a.status, updatedAt: a.updatedAt
  }
}

/** 某人一段时间的假勤记录（日历下面的明细、我的假期） */
export async function absencesOf(ctx, { userId, from, to, category, includeCancelled } = {}) {
  const uid = Number(userId) || ctx.user.id
  if (!(await canSee(ctx, uid))) throw forbidden('只能看自己和下属的')
  const where = {
    userId: uid,
    ...(includeCancelled ? {} : { status: 'APPROVED' }),
    ...(category ? { category } : {}),
    ...(isDateStr(to) ? { startDate: { lte: to } } : {}),
    ...(isDateStr(from) ? { endDate: { gte: from } } : {})
  }
  const opts = await unitOpts()
  const rows = await prisma.absence.findMany({ where, orderBy: { startDate: 'desc' }, take: 500 })
  return rows.map(a => absenceDto(a, opts))
}

/** 团队的假勤记录（负责人看下属，人事看全部） */
export async function teamAbsences(ctx, { from, to, category } = {}) {
  if (!(await canSeeTeam(ctx))) throw forbidden('只有部门负责人和人事能看团队的')
  const scope = await visibleScope(ctx)
  const opts = await unitOpts()
  const rows = await prisma.absence.findMany({
    where: { status: 'APPROVED', ...(scope.all ? {} : { userId: { in: [...scope.ids] } }), ...(category ? { category } : {}), ...(isDateStr(to) ? { startDate: { lte: to } } : {}), ...(isDateStr(from) ? { endDate: { gte: from } } : {}) },
    orderBy: { startDate: 'desc' }, take: 1000
  })
  return rows.map(a => ({ userId: a.userId, ...absenceDto(a, opts) }))
}

/** 今年各类请假用了多少天（画像用）：{ 年假: 2.5 } */
export async function leaveUsedByType(userId, year) {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const day = (await absenceMap([userId], from, to)).get(userId) || new Map()
  const out = {}
  for (const v of day.values()) for (const l of v.leave) out[l.name] = round2((out[l.name] || 0) + l.units)
  return out
}
