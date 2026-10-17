// 假期余额（人事）：年假按工龄发放、手工调整、年末结转；员工的人事字段（入职日期、参加工作日期、审批人）；人事成员
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { currentYear, isDateStr, leaveUnits, unitsByYear } from '../lib/dates.js'
import { workdayFn } from './holidays.js'
import { annualEntitlement } from '../lib/annualLeave.js'
import { requireHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { balanceOf } from './leave.js'
import { getSettings } from './settings.js'

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const round1 = (n) => Math.round(n * 10) / 10

/** 我的余额（本年，或指定年） */
export async function myBalance(ctx, { year } = {}) {
  const s = await getSettings()
  const y = Number(year) || currentYear(s.timezone)
  const [types, bal] = await Promise.all([
    prisma.leaveType.findMany({ where: { active: true, balanced: true }, orderBy: { sort: 'asc' } }),
    balanceOf(ctx.user.id, y)
  ])
  return { year: y, items: types.map(t => ({ code: t.code, name: t.name, ...(bal[t.code] || { balance: 0, pending: 0, available: 0 }) })) }
}

/** 全员余额表 */
export async function balanceTable(ctx, { year, keyword } = {}) {
  await requireHr(ctx)
  const s = await getSettings()
  const y = Number(year) || currentYear(s.timezone)
  const types = await prisma.leaveType.findMany({ where: { balanced: true }, orderBy: { sort: 'asc' } })
  let emps = await prisma.employee.findMany({ where: { active: true }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  if (keyword) emps = emps.filter(e => e.name.includes(keyword) || e.jobNumber?.includes(keyword) || e.deptPath?.includes(keyword))
  const [ledger, pending] = await Promise.all([
    prisma.leaveLedger.groupBy({ by: ['userId', 'typeCode'], where: { year: y }, _sum: { delta: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'PENDING', startDate: { lte: `${y}-12-31` }, endDate: { gte: `${y}-01-01` } } })
  ])
  const key = (u, t) => `${u}:${t}`
  const bal = new Map(ledger.map(g => [key(g.userId, g.typeCode), Number(g._sum.delta || 0)]))
  // 跨年的待审批只算落在这一年的部分（和 balanceOf 一致）
  const isWork = await workdayFn()
  const pen = new Map()
  for (const r of pending) {
    const n = unitsByYear(leaveUnits(r, isWork))[y] || 0
    pen.set(key(r.userId, r.typeCode), (pen.get(key(r.userId, r.typeCode)) || 0) + n)
  }
  const approvers = new Map((await prisma.employee.findMany({ where: { id: { in: emps.map(e => e.approverId).filter(Boolean) } } })).map(e => [e.id, e]))
  return {
    year: y,
    types: types.map(t => ({ code: t.code, name: t.name })),
    rows: emps.map(e => ({
      employee: employeeBrief(e), hireDate: day(e.hireDate), workStartDate: day(e.workStartDate), approver: employeeBrief(approvers.get(e.approverId)),
      balances: Object.fromEntries(types.map(t => [t.code, { balance: round1(bal.get(key(e.id, t.code)) || 0), pending: round1(pen.get(key(e.id, t.code)) || 0) }]))
    }))
  }
}

/** 某人某年某类假的流水 */
export async function ledgerOf(ctx, { userId, year, typeCode }) {
  const uid = Number(userId) || ctx.user.id
  if (uid !== ctx.user.id) await requireHr(ctx)
  const rows = await prisma.leaveLedger.findMany({
    where: { userId: uid, ...(year ? { year: Number(year) } : {}), ...(typeCode ? { typeCode } : {}) },
    orderBy: { id: 'desc' }, take: 500
  })
  return rows.map(r => ({ ...r, delta: Number(r.delta) }))
}

/**
 * 发放 / 重新核算某年年假。每人 GRANT 流水之和 = 应发天数：没发过的发，算出来变了的补一条差额。
 * preview=true 只算不写。缺参加工作日期的人列出来请人事补
 */
export async function grantAnnual(ctx, { year, preview = false, userIds } = {}) {
  await requireHr(ctx)
  const s = await getSettings()
  const y = Number(year) || currentYear(s.timezone)
  if (y < 2000 || y > 2100) throw badRequest('年份不对')
  const emps = await prisma.employee.findMany({ where: { active: true, ...(userIds?.length ? { id: { in: userIds.map(Number) } } : {}) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  const granted = await prisma.leaveLedger.groupBy({ by: ['userId'], where: { year: y, typeCode: 'ANNUAL', kind: 'GRANT' }, _sum: { delta: true } })
  const had = new Map(granted.map(g => [g.userId, Number(g._sum.delta || 0)]))
  const rows = [], missing = []
  for (const e of emps) {
    const r = annualEntitlement({ workStartDate: day(e.workStartDate), hireDate: day(e.hireDate), year: y, extraDays: s.annualExtraDays, rounding: s.annualRounding })
    if (!r) { missing.push(employeeBrief(e)); continue }
    const before = had.get(e.id) || 0
    rows.push({ employee: employeeBrief(e), days: r.days, before, delta: round1(r.days - before), segments: r.segments })
  }
  const changes = rows.filter(r => r.delta !== 0)
  if (!preview && changes.length) {
    await prisma.leaveLedger.createMany({
      data: changes.map(r => ({
        userId: r.employee.id, year: y, typeCode: 'ANNUAL', delta: r.delta, kind: 'GRANT', createdBy: ctx.user.id,
        note: (r.before ? `重新核算：${r.before} → ${r.days} 天；` : '') + r.segments.map(x => `${x.from}~${x.to} 按每年 ${x.perYear} 天`).join('；').slice(0, 250)
      }))
    })
    audit(ctx, 'balance.grantAnnual', { entityType: 'balance', detail: { year: y, changed: changes.length } })
  }
  return { year: y, preview, rows, changed: changes.length, missing }
}

/** 手工调整（加 / 扣），必须写原因 */
export async function adjust(ctx, { userId, year, typeCode, delta, note }) {
  await requireHr(ctx)
  const n = Number(delta)
  if (!Number.isFinite(n) || n === 0 || Math.round(n * 2) !== n * 2) throw badRequest('调整天数是 0.5 的倍数，不能为 0')
  if (!String(note || '').trim()) throw badRequest('写一下调整原因')
  const type = await prisma.leaveType.findUnique({ where: { code: typeCode } })
  if (!type?.balanced) throw badRequest('这种假不扣余额，不用调整')
  const emp = await prisma.employee.findUnique({ where: { id: Number(userId) } })
  if (!emp) throw notFound('没有这个员工')
  const row = await prisma.leaveLedger.create({ data: { userId: emp.id, year: Number(year), typeCode, delta: n, kind: 'ADJUST', note: String(note).slice(0, 300), createdBy: ctx.user.id } })
  audit(ctx, 'balance.adjust', { entityType: 'balance', entityId: emp.id, detail: { year: Number(year), typeCode, delta: n } })
  return { ...row, delta: Number(row.delta) }
}

/**
 * 年末结转：fromYear 年的年假余额清零（EXPIRE），其中最多 carryOverMaxDays 天转到下一年（CARRY_OVER）。
 * 做过的人跳过；有待审批年假的人先跳过（批完再做一次）
 */
export async function carryOver(ctx, { fromYear, preview = false }) {
  await requireHr(ctx)
  const s = await getSettings()
  const y = Number(fromYear)
  if (!y) throw badRequest('要结转哪一年')
  const max = s.carryOverMaxDays
  const [ledger, done, pending] = await Promise.all([
    prisma.leaveLedger.groupBy({ by: ['userId'], where: { year: y, typeCode: 'ANNUAL' }, _sum: { delta: true } }),
    prisma.leaveLedger.findMany({ where: { year: y, typeCode: 'ANNUAL', kind: 'EXPIRE' }, select: { userId: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'PENDING', typeCode: 'ANNUAL', startDate: { lte: `${y}-12-31` }, endDate: { gte: `${y}-01-01` } }, select: { userId: true } })
  ])
  const skip = new Set([...done.map(d => d.userId), ...pending.map(p => p.userId)])
  const emps = new Map((await prisma.employee.findMany()).map(e => [e.id, e]))
  const rows = ledger
    .map(g => ({ userId: g.userId, remaining: round1(Number(g._sum.delta || 0)) }))
    .filter(r => r.remaining > 0 && !skip.has(r.userId))
    .map(r => ({ employee: employeeBrief(emps.get(r.userId)), remaining: r.remaining, carry: Math.min(r.remaining, max) }))
  if (!preview && rows.length) {
    await prisma.$transaction(rows.flatMap(r => [
      prisma.leaveLedger.create({ data: { userId: r.employee.id, year: y, typeCode: 'ANNUAL', delta: -r.remaining, kind: 'EXPIRE', note: `年末结转：${r.carry} 天转入 ${y + 1} 年，其余清零`, createdBy: ctx.user.id } }),
      ...(r.carry > 0 ? [prisma.leaveLedger.create({ data: { userId: r.employee.id, year: y + 1, typeCode: 'ANNUAL', delta: r.carry, kind: 'CARRY_OVER', note: `${y} 年结转`, createdBy: ctx.user.id } })] : [])
    ]))
    audit(ctx, 'balance.carryOver', { entityType: 'balance', detail: { fromYear: y, people: rows.length, max } })
  }
  return { fromYear: y, preview, maxDays: max, rows, skippedPending: [...new Set(pending.map(p => p.userId))].length }
}

/** 人事字段：入职日期、参加工作日期、指定审批人 */
export async function updateEmployee(ctx, id, body = {}) {
  await requireHr(ctx)
  const emp = await prisma.employee.findUnique({ where: { id: Number(id) } })
  if (!emp) throw notFound('没有这个员工')
  const data = {}
  for (const k of ['hireDate', 'workStartDate']) {
    if (body[k] === undefined) continue
    if (body[k] && !isDateStr(body[k])) throw badRequest('日期格式是 YYYY-MM-DD')
    data[k] = body[k] ? new Date(body[k] + 'T00:00:00Z') : null
  }
  if (body.approverId !== undefined) {
    const a = body.approverId ? Number(body.approverId) : null
    if (a === emp.id) throw badRequest('审批人不能是本人')
    if (a && !(await prisma.employee.findUnique({ where: { id: a } }))) throw badRequest('没有这个审批人')
    data.approverId = a
  }
  const u = await prisma.employee.update({ where: { id: emp.id }, data })
  audit(ctx, 'employee.update', { entityType: 'employee', entityId: emp.id, detail: Object.fromEntries(Object.keys(data).map(k => [k, body[k] ?? null])) })
  return { ...employeeBrief(u), hireDate: day(u.hireDate), workStartDate: day(u.workStartDate), approverId: u.approverId }
}

/** 批量导入人事字段：每行「工号或姓名, 入职日期, 参加工作日期」 */
export async function importEmployeeDates(ctx, { text }) {
  await requireHr(ctx)
  const emps = await prisma.employee.findMany({ where: { active: true } })
  const byNo = new Map(emps.filter(e => e.jobNumber).map(e => [e.jobNumber, e]))
  const byName = new Map()
  for (const e of emps) byName.set(e.name, byName.has(e.name) ? 'DUP' : e)
  const ok = [], errors = []
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const [who, hire, work] = t.split(/[\t,，]+/).map(x => x.trim())
    const e = byNo.get(who) || byName.get(who)
    if (!e) return errors.push(`第 ${i + 1} 行：找不到「${who}」`)
    if (e === 'DUP') return errors.push(`第 ${i + 1} 行：有重名的「${who}」，请用工号`)
    if ((hire && !isDateStr(hire)) || (work && !isDateStr(work))) return errors.push(`第 ${i + 1} 行：日期格式是 YYYY-MM-DD`)
    ok.push({ id: e.id, hire, work })
  })
  if (errors.length) throw badRequest(errors.slice(0, 8).join('；'))
  for (const r of ok) {
    await prisma.employee.update({
      where: { id: r.id },
      data: { ...(r.hire ? { hireDate: new Date(r.hire + 'T00:00:00Z') } : {}), ...(r.work ? { workStartDate: new Date(r.work + 'T00:00:00Z') } : {}) }
    })
  }
  audit(ctx, 'employee.importDates', { entityType: 'employee', detail: { count: ok.length } })
  return { saved: ok.length }
}

// ---------- 人事成员 ----------
export async function listHr(ctx) {
  await requireHr(ctx)
  const rows = await prisma.roleMember.findMany({ where: { role: 'HR' } })
  const emps = new Map((await prisma.employee.findMany({ where: { id: { in: rows.map(r => r.userId) } } })).map(e => [e.id, e]))
  return rows.map(r => ({ ...employeeBrief(emps.get(r.userId)) || { id: r.userId }, addedAt: r.createdAt }))
}

export async function addHr(ctx, { userId }) {
  await requireHr(ctx)
  const emp = await prisma.employee.findUnique({ where: { id: Number(userId) } })
  if (!emp) throw notFound('没有这个员工')
  await prisma.roleMember.upsert({ where: { userId_role: { userId: emp.id, role: 'HR' } }, create: { userId: emp.id, role: 'HR', createdBy: ctx.user.id }, update: {} })
  audit(ctx, 'role.add', { entityType: 'role', entityId: emp.id, detail: { role: 'HR', name: emp.name } })
  return { ok: true }
}

export async function removeHr(ctx, userId) {
  await requireHr(ctx)
  await prisma.roleMember.deleteMany({ where: { userId: Number(userId), role: 'HR' } })
  audit(ctx, 'role.remove', { entityType: 'role', entityId: userId, detail: { role: 'HR' } })
  return { ok: true }
}

/** 选人用（人事给员工指定审批人、加人事成员） */
/** 选人：人事从全公司选，负责人从自己能看的人里选 */
export async function searchEmployees(ctx, { keyword } = {}) {
  const scope = await visibleScope(ctx)
  if (!scope.all && scope.ids.size <= 1) throw forbidden('只有人事和部门负责人能选人')
  const k = String(keyword || '').trim()
  const rows = await prisma.employee.findMany({
    where: { active: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }), ...(k ? { OR: [{ name: { contains: k } }, { jobNumber: { contains: k } }, { deptPath: { contains: k } }] } : {}) },
    orderBy: { name: 'asc' }, take: 30
  })
  return rows.map(employeeBrief)
}
