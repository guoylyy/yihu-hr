// 假期类型和余额。请假本身在钉钉 / 飞书 / 企业微信里提交、审批，同步过来只读（services/absences.js）；
// 本应用只管类型（对上各家的假期名称）和余额（只看流水 LeaveLedger）
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { requireHr } from './access.js'
import { audit } from './audit.js'

export const DEFAULT_TYPES = [
  { code: 'ANNUAL', name: '年假', paid: true, balanced: true, unit: 'HALF', sort: 1, note: '按法定工龄折算发放，人事在「假期余额」里发；钉钉 / 飞书 / 企业微信里批了的年假自动扣' },
  { code: 'COMP', name: '调休', paid: true, balanced: true, unit: 'HALF', sort: 2, note: '余额由人事调整或导入' },
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
/** 某人某年各类假的余额：{ [code]: { balance, available } }（请假在各家审批，没有「待审批占用」，可用 = 余额） */
export async function balanceOf(userId, year, db = prisma) {
  const ledger = await db.leaveLedger.groupBy({ by: ['typeCode'], where: { userId, year }, _sum: { delta: true } })
  const out = {}
  for (const g of ledger) {
    const b = Math.round(Number(g._sum.delta || 0) * 100) / 100
    out[g.typeCode] = { balance: b, available: b }
  }
  return out
}
