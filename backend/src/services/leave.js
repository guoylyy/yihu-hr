// 请假：提交 → 审批人（指定的 → 部门负责人 → 人事）批 → 扣余额；撤销退回余额
// 余额只看流水（LeaveLedger）；「可用」= 余额 − 待审批占用
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { dayInTz, diffDays, halfSlots, isDateStr, leaveUnits, sumUnits, unitsByYear } from '../lib/dates.js'
import { notify } from '../lib/platform.js'
import { canSeeTeam, deptPaths, isHr, requireHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { workdayFn } from './holidays.js'
import { getSettings } from './settings.js'

export const DEFAULT_TYPES = [
  { code: 'ANNUAL', name: '年假', paid: true, balanced: true, unit: 'HALF', sort: 1, note: '按法定工龄折算发放，人事在「假期余额」里发' },
  { code: 'COMP', name: '调休', paid: true, balanced: true, unit: 'HALF', sort: 2, note: '余额由人事按加班登记' },
  { code: 'PERSONAL', name: '事假', paid: false, balanced: false, unit: 'HALF', sort: 3 },
  { code: 'SICK', name: '病假', paid: true, balanced: false, unit: 'HALF', sort: 4 },
  { code: 'MARRIAGE', name: '婚假', paid: true, balanced: false, unit: 'DAY', sort: 5 },
  { code: 'MATERNITY', name: '产假', paid: true, balanced: false, unit: 'DAY', sort: 6 },
  { code: 'PATERNITY', name: '陪产假', paid: true, balanced: false, unit: 'DAY', sort: 7 },
  { code: 'BEREAVEMENT', name: '丧假', paid: true, balanced: false, unit: 'DAY', sort: 8 }
]

export async function seedLeaveTypes() {
  if (await prisma.leaveType.count()) return
  await prisma.leaveType.createMany({ data: DEFAULT_TYPES, skipDuplicates: true })
}

const STATUS_LABEL = { PENDING: '待审批', APPROVED: '已批准', REJECTED: '已驳回', CANCELLED: '已撤销' }

async function dto(r, emps) {
  const map = emps || new Map((await prisma.employee.findMany({ where: { id: { in: [r.userId, r.approverId, r.decidedBy].filter(Boolean) } } })).map(e => [e.id, e]))
  return {
    ...r, days: Number(r.days), statusLabel: STATUS_LABEL[r.status],
    employee: employeeBrief(map.get(r.userId)), approver: employeeBrief(map.get(r.approverId)), decider: employeeBrief(map.get(r.decidedBy))
  }
}

async function dtos(rows) {
  const ids = [...new Set(rows.flatMap(r => [r.userId, r.approverId, r.decidedBy]).filter(Boolean))]
  const map = new Map((await prisma.employee.findMany({ where: { id: { in: ids } } })).map(e => [e.id, e]))
  return Promise.all(rows.map(r => dto(r, map)))
}

// ---------- 假期类型 ----------
export async function listTypes(ctx, { all } = {}) {
  return prisma.leaveType.findMany({ where: all ? {} : { active: true }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] })
}

export async function saveType(ctx, body) {
  await requireHr(ctx)
  const code = String(body.code || '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(code)) throw badRequest('代码用大写字母、数字、下划线，2~20 位')
  const name = String(body.name || '').trim()
  if (!name || name.length > 30) throw badRequest('名称 1~30 字')
  if (!['DAY', 'HALF'].includes(body.unit || 'HALF')) throw badRequest('最小单位是 DAY 或 HALF')
  const data = { name, paid: !!body.paid, balanced: !!body.balanced, unit: body.unit || 'HALF', active: body.active !== false, sort: Number(body.sort) || 0, note: body.note ? String(body.note).slice(0, 200) : null }
  const t = await prisma.leaveType.upsert({ where: { code }, create: { code, ...data }, update: data })
  audit(ctx, 'leaveType.save', { entityType: 'leaveType', entityId: code, detail: data })
  return t
}

// ---------- 余额 ----------
/** 某人某年各类假的余额和待审批占用：{ [code]: { balance, pending, available } } */
export async function balanceOf(userId, year, db = prisma) {
  const [ledger, pending] = await Promise.all([
    db.leaveLedger.groupBy({ by: ['typeCode'], where: { userId, year }, _sum: { delta: true } }),
    db.leaveRequest.findMany({ where: { userId, status: 'PENDING' } })
  ])
  const out = {}
  for (const g of ledger) out[g.typeCode] = { balance: Number(g._sum.delta || 0), pending: 0 }
  const isWork = await workdayFn()
  for (const r of pending) {
    const y = unitsByYear(leaveUnits(r, isWork))[year]
    if (!y) continue
    out[r.typeCode] = out[r.typeCode] || { balance: 0, pending: 0 }
    out[r.typeCode].pending += y
  }
  for (const v of Object.values(out)) v.available = Math.round((v.balance - v.pending) * 10) / 10
  return out
}

// ---------- 审批人 ----------
/** 指定的审批人 → 主部门往上找最近的负责人（不是本人、在职）→ null（人事审批） */
export async function resolveApprover(emp) {
  if (emp.approverId && emp.approverId !== emp.id) {
    const a = await prisma.employee.findUnique({ where: { id: emp.approverId } })
    if (a?.active) return a.id
  }
  const all = await prisma.employee.findMany({ where: { active: true } })
  const paths = deptPaths(all)
  const leadersByPath = new Map()
  for (const e of all) {
    if (e.id === emp.id) continue
    for (const d of e.leaderOf || []) {
      const p = paths.get(d)
      if (p) leadersByPath.set(p, [...(leadersByPath.get(p) || []), e.id])
    }
  }
  const primary = (emp.depts || []).find(d => d.isPrimary) || (emp.depts || [])[0]
  if (!primary?.path) return null
  const parts = primary.path.split('/')
  for (let i = parts.length; i > 0; i--) {
    const hit = leadersByPath.get(parts.slice(0, i).join('/'))
    if (hit?.length) return hit[0]
  }
  return null
}

async function hrIds() {
  return (await prisma.roleMember.findMany({ where: { role: 'HR' } })).map(r => r.userId)
}

// ---------- 提交 / 撤销 / 审批 ----------
function normalizeInput(b) {
  const r = {
    typeCode: String(b.typeCode || b.type || '').toUpperCase(),
    startDate: b.startDate, startHalf: b.startHalf || 'AM',
    endDate: b.endDate || b.startDate, endHalf: b.endHalf || 'PM',
    reason: b.reason ? String(b.reason).trim().slice(0, 500) : null
  }
  if (!isDateStr(r.startDate) || !isDateStr(r.endDate)) throw badRequest('开始、结束日期格式是 YYYY-MM-DD')
  if (r.endDate < r.startDate) throw badRequest('结束日期不能早于开始日期')
  if (diffDays(r.startDate, r.endDate) > 365) throw badRequest('一次最多请一年')
  if (!['AM', 'PM'].includes(r.startHalf) || !['AM', 'PM'].includes(r.endHalf)) throw badRequest('半天写 AM（上午）或 PM（下午）')
  return r
}

export async function submitLeave(ctx, body = {}) {
  const input = normalizeInput(body)
  const type = await prisma.leaveType.findUnique({ where: { code: input.typeCode } })
  if (!type?.active) throw badRequest(`没有这种假：${input.typeCode}`)
  if (type.unit === 'DAY' && (input.startHalf !== 'AM' || input.endHalf !== 'PM')) throw badRequest(`${type.name}按整天请`)
  const isWork = await workdayFn()
  const units = leaveUnits(input, isWork)
  const days = sumUnits(units)
  if (days <= 0) throw badRequest('这段时间没有工作日，不用请假')
  const uid = ctx.user.id
  const emp = await prisma.employee.findUnique({ where: { id: uid } })
  if (!emp) throw badRequest('还没同步到你的员工信息，请稍后再试或联系人事')

  const created = await prisma.$transaction(async (tx) => {
    // 同一个人的请假串行处理，防止并发提交透支余额
    await tx.$queryRaw`SELECT id FROM Employee WHERE id = ${uid} FOR UPDATE`
    const mine = await tx.leaveRequest.findMany({ where: { userId: uid, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } } })
    const slots = halfSlots(input, isWork)
    for (const m of mine) {
      if ([...halfSlots(m, isWork)].some(x => slots.has(x))) throw badRequest(`和已有的请假（${m.startDate} ~ ${m.endDate}）时间重叠`)
    }
    if (type.balanced) {
      for (const [y, need] of Object.entries(unitsByYear(units))) {
        const b = (await balanceOf(uid, Number(y), tx))[type.code] || { available: 0 }
        if (b.available < need) throw badRequest(`${y} 年${type.name}可用 ${b.available} 天，不够 ${need} 天`)
      }
    }
    return tx.leaveRequest.create({
      data: { userId: uid, ...input, days, approverId: await resolveApprover(emp), via: ctx.via === 'AI' ? 'AI' : 'WEB' }
    })
  })

  audit(ctx, 'leave.submit', { entityType: 'leave', entityId: created.id, detail: { type: type.code, days } })
  const s = await getSettings()
  if (s.notifyApprover) {
    const to = created.approverId ? [created.approverId] : await hrIds()
    notify(to, { title: `${emp.name}的${type.name}申请待你审批`, content: `**${emp.name}** 申请${type.name} ${days} 天\n${input.startDate} ~ ${input.endDate}${input.reason ? `\n事由：${input.reason}` : ''}`, path: '/approvals' })
  }
  return dto(created)
}

async function load(id) {
  const r = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } })
  if (!r) throw notFound('没有这条请假')
  return r
}

async function writeUse(tx, r, kind, by) {
  const type = await tx.leaveType.findUnique({ where: { code: r.typeCode } })
  if (!type?.balanced) return
  const sign = kind === 'USE' ? -1 : 1
  for (const [y, n] of Object.entries(unitsByYear(leaveUnits(r, await workdayFn())))) {
    await tx.leaveLedger.create({ data: { userId: r.userId, year: Number(y), typeCode: r.typeCode, delta: sign * n, kind, requestId: r.id, createdBy: by, note: kind === 'USE' ? `请假 #${r.id}` : `撤销请假 #${r.id}` } })
  }
}

/** 审批：approve=true 批准，false 驳回 */
export async function decideLeave(ctx, id, { approve, note } = {}) {
  const r = await load(id)
  if (r.status !== 'PENDING') throw badRequest(`这条请假${STATUS_LABEL[r.status]}，不能再审批`)
  if (r.userId === ctx.user.id) throw forbidden('不能审批自己的请假')
  const hr = await isHr(ctx)
  if (r.approverId !== ctx.user.id && !hr) throw forbidden('这条请假不归你审批')
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Employee WHERE id = ${r.userId} FOR UPDATE`
    const fresh = await tx.leaveRequest.findUnique({ where: { id: r.id } })
    if (fresh.status !== 'PENDING') throw badRequest('这条请假刚被处理过了')
    const u = await tx.leaveRequest.update({
      where: { id: r.id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: ctx.user.id, decidedAt: new Date(), decisionNote: note ? String(note).slice(0, 500) : null }
    })
    if (approve) await writeUse(tx, u, 'USE', ctx.user.id)
    return u
  })
  audit(ctx, approve ? 'leave.approve' : 'leave.reject', { entityType: 'leave', entityId: r.id, detail: { userId: r.userId, days: Number(r.days) } })
  const type = await prisma.leaveType.findUnique({ where: { code: r.typeCode } })
  notify([r.userId], { title: `你的${type?.name || '请假'}申请${approve ? '已批准' : '被驳回'}`, content: `${r.startDate} ~ ${r.endDate}，${Number(r.days)} 天${note ? `\n审批意见：${note}` : ''}`, path: '/leave' })
  return dto(updated)
}

/** 撤销：本人可撤销待审批的、和还没开始的已批准的；人事可撤销任何已批准的 */
export async function cancelLeave(ctx, id, { note } = {}) {
  const r = await load(id)
  const hr = await isHr(ctx)
  const s = await getSettings()
  const today = dayInTz(new Date(), s.timezone)
  if (r.userId !== ctx.user.id && !hr) throw forbidden('只能撤销自己的请假')
  if (!['PENDING', 'APPROVED'].includes(r.status)) throw badRequest(`这条请假${STATUS_LABEL[r.status]}`)
  if (r.status === 'APPROVED' && !hr && r.startDate <= today) throw badRequest('已经开始的假要找人事撤销')
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Employee WHERE id = ${r.userId} FOR UPDATE`
    const fresh = await tx.leaveRequest.findUnique({ where: { id: r.id } })
    if (fresh.status !== r.status) throw badRequest('这条请假刚被处理过了')
    const u = await tx.leaveRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', decisionNote: note ? String(note).slice(0, 500) : fresh.decisionNote } })
    if (r.status === 'APPROVED') await writeUse(tx, u, 'RESTORE', ctx.user.id)
    return u
  })
  audit(ctx, 'leave.cancel', { entityType: 'leave', entityId: r.id, detail: { userId: r.userId, wasApproved: r.status === 'APPROVED' } })
  if (r.userId !== ctx.user.id) notify([r.userId], { title: '你的请假已被人事撤销', content: `${r.startDate} ~ ${r.endDate}${note ? `\n说明：${note}` : ''}`, path: '/leave' })
  else if (r.status === 'PENDING' && r.approverId) notify([r.approverId], { title: '一条请假申请已撤回', content: `${r.startDate} ~ ${r.endDate}`, path: '/approvals' })
  return dto(updated)
}

// ---------- 查询 ----------
export async function myRequests(ctx, { year } = {}) {
  const y = Number(year) || null
  const rows = await prisma.leaveRequest.findMany({
    where: { userId: ctx.user.id, ...(y ? { startDate: { lte: `${y}-12-31` }, endDate: { gte: `${y}-01-01` } } : {}) },
    orderBy: { id: 'desc' }, take: 200
  })
  return dtos(rows)
}

/** 等我审批的：指派给我的；人事还包括没有审批人的 */
export async function pendingForMe(ctx) {
  const hr = await isHr(ctx)
  const rows = await prisma.leaveRequest.findMany({
    where: { status: 'PENDING', userId: { not: ctx.user.id }, OR: [{ approverId: ctx.user.id }, ...(hr ? [{ approverId: null }] : [])] },
    orderBy: { id: 'asc' }, take: 200
  })
  return dtos(rows)
}

/** 团队 / 全部请假记录（负责人看下属，人事看全部） */
export async function teamRequests(ctx, { status, from, to, userId } = {}) {
  if (!(await canSeeTeam(ctx))) throw forbidden('只有部门负责人和人事能看团队请假')
  const scope = await visibleScope(ctx)
  const where = {
    ...(scope.all ? {} : { userId: { in: [...scope.ids] } }),
    ...(userId ? { userId: Number(userId) } : {}),
    ...(status ? { status } : {}),
    ...(from && isDateStr(from) ? { endDate: { gte: from } } : {}),
    ...(to && isDateStr(to) ? { startDate: { lte: to } } : {})
  }
  if (userId && !scope.all && !scope.ids.has(Number(userId))) throw forbidden()
  return dtos(await prisma.leaveRequest.findMany({ where, orderBy: { id: 'desc' }, take: 500 }))
}

export async function getRequest(ctx, id) {
  const r = await load(id)
  const scope = await visibleScope(ctx)
  if (!scope.all && !scope.ids.has(r.userId) && r.approverId !== ctx.user.id) throw forbidden()
  return dto(r)
}

/** 预估天数（前端填表时实时显示） */
export async function estimate(ctx, q) {
  const input = normalizeInput(q)
  const units = leaveUnits(input, await workdayFn())
  return { days: sumUnits(units), byYear: unitsByYear(units) }
}

export { STATUS_LABEL }
