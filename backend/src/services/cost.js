// 人员成本：每人的标准成本 + 每月成本表。人事录、改、生成、导入；负责人看下属的（设置里能关）
// 金额是敏感数据：留痕和上报平台的使用数据里只记「谁、哪个月、哪一类」，不记金额
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden } from '../lib/http.js'
import { monthRange } from '../lib/dates.js'
import { CATEGORIES, PROFILE_FIELDS, employedIn, generateMonth, lastMonths, money, summarize } from '../lib/cost.js'
import { costScope, inScope, requireHr } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { today } from './contracts.js'

const checkMonth = (m) => { if (!monthRange(m || '')) throw badRequest('月份格式是 YYYY-MM'); return m }
const profileDto = (p) => (p ? { salary: money(p.salary), social: money(p.social), housing: money(p.housing), benefit: money(p.benefit), note: p.note, total: money(Number(p.salary) + Number(p.social) + Number(p.housing) + Number(p.benefit)) } : null)

async function scopedEmployees(ctx, { keyword, includeLeft = false, month } = {}) {
  const scope = await costScope(ctx)
  if (!scope.all && !scope.ids.size) throw forbidden('只有人事和部门负责人能看人员成本')
  let emps = await prisma.employee.findMany({ where: { ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  emps = emps.filter(e => (includeLeft || e.active) || (month && employedIn(e, month)))
  const k = String(keyword || '').trim()
  if (k) emps = emps.filter(e => e.name.includes(k) || e.jobNumber?.includes(k) || e.deptPath?.includes(k))
  return { scope, emps }
}

/** 某月的成本表：每人一行，各类别一列，带标准成本 */
export async function costTable(ctx, { month, keyword } = {}) {
  const ym = month || (await today()).slice(0, 7)
  checkMonth(ym)
  const { scope, emps } = await scopedEmployees(ctx, { keyword, month: ym })
  const ids = emps.map(e => e.id)
  const [items, profiles] = await Promise.all([
    prisma.costItem.findMany({ where: { month: ym, userId: { in: ids } } }),
    prisma.costProfile.findMany({ where: { userId: { in: ids } } })
  ])
  const prof = new Map(profiles.map(p => [p.userId, p]))
  const rows = emps.filter(e => e.active || items.some(i => i.userId === e.id)).map(e => {
    const mine = items.filter(i => i.userId === e.id)
    return {
      employee: employeeBrief(e),
      items: Object.fromEntries(mine.map(i => [i.category, { amount: money(i.amount), source: i.source, note: i.note }])),
      total: summarize(mine).amount,
      profile: profileDto(prof.get(e.id))
    }
  })
  const sum = summarize(items)
  return { month: ym, rows, total: sum.amount, byCategory: sum.byCategory, categories: CATEGORIES, canEdit: scope.all, headcount: rows.length }
}

/** 录一个数：同一人同一月同一类只有一个数，金额为空 / 0 就删掉 */
export async function setItem(ctx, { userId, month, category, amount, note } = {}) {
  await requireHr(ctx)
  checkMonth(month)
  if (!CATEGORIES[category]) throw badRequest('成本类别不对')
  const uid = Number(userId)
  if (!(await prisma.employee.findUnique({ where: { id: uid } }))) throw badRequest('没有这个员工')
  const a = amount === '' || amount == null ? 0 : Number(amount)
  if (!Number.isFinite(a) || a < 0 || a > 1e9) throw badRequest('金额不对')
  const key = { userId_month_category: { userId: uid, month, category } }
  if (!a) await prisma.costItem.deleteMany({ where: { userId: uid, month, category } })
  else await prisma.costItem.upsert({ where: key, create: { userId: uid, month, category, amount: money(a), note: note || null, source: 'MANUAL', updatedBy: ctx.user.id }, update: { amount: money(a), note: note ?? undefined, source: 'MANUAL', updatedBy: ctx.user.id } })
  audit(ctx, 'cost.set', { entityType: 'employee', entityId: uid, detail: { month, category } })
  return { ok: true }
}

/** 标准成本（每月）：生成成本表时按它填 */
export async function setProfile(ctx, userId, body = {}) {
  await requireHr(ctx)
  const uid = Number(userId)
  if (!(await prisma.employee.findUnique({ where: { id: uid } }))) throw badRequest('没有这个员工')
  const data = { updatedBy: ctx.user.id, note: body.note ? String(body.note).slice(0, 300) : null }
  for (const k of Object.keys(PROFILE_FIELDS)) {
    const v = Number(body[k] || 0)
    if (!Number.isFinite(v) || v < 0 || v > 1e8) throw badRequest('金额不对')
    data[k] = money(v)
  }
  const p = await prisma.costProfile.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data })
  audit(ctx, 'cost.profile', { entityType: 'employee', entityId: uid })
  return profileDto(p)
}

/** 按标准成本和竞业协议生成某月成本（已经有的数不动）。preview 只算不写 */
export async function generate(ctx, { month, preview = true } = {}) {
  await requireHr(ctx)
  checkMonth(month)
  const [employees, profiles, contracts, existing] = await Promise.all([
    prisma.employee.findMany(),
    prisma.costProfile.findMany(),
    prisma.contract.findMany({ where: { kind: 'NON_COMPETE', deletedAt: null } }),
    prisma.costItem.findMany({ where: { month }, select: { userId: true, category: true } })
  ])
  const rows = generateMonth({
    month, contracts,
    employees: employees.map(e => ({ ...e, hireDate: e.hireDate?.toISOString().slice(0, 10), leaveDate: e.leaveDate?.toISOString().slice(0, 10) })),
    profiles: new Map(profiles.map(p => [p.userId, p])),
    existing: new Set(existing.map(x => `${x.userId}:${x.category}`))
  })
  const names = new Map(employees.map(e => [e.id, e.name]))
  const noProfile = employees.filter(e => e.active && employedIn(e, month) && !profiles.some(p => p.userId === e.id)).map(employeeBrief)
  const out = { month, count: rows.length, total: summarize(rows).amount, rows: rows.map(r => ({ ...r, name: names.get(r.userId) })), noProfile }
  if (preview) return out
  if (rows.length) await prisma.costItem.createMany({ data: rows.map(r => ({ ...r, updatedBy: ctx.user.id })), skipDuplicates: true })
  audit(ctx, 'cost.generate', { entityType: 'month', entityId: month, detail: { count: rows.length } })
  return out
}

/** 批量导入：每行「工号或姓名, 类别, 金额[, 备注]」，类别写中文名或代码；同类已有的覆盖 */
export async function importItems(ctx, { month, text, preview = true } = {}) {
  await requireHr(ctx)
  checkMonth(month)
  const emps = await prisma.employee.findMany()
  const byNo = new Map(emps.filter(e => e.jobNumber).map(e => [e.jobNumber, e]))
  const byName = new Map()
  for (const e of emps) byName.set(e.name, byName.has(e.name) ? null : e) // 重名的不认，要写工号
  const catOf = (s) => (CATEGORIES[s.toUpperCase()] ? s.toUpperCase() : Object.entries(CATEGORIES).find(([, l]) => l === s || l.replace(/（.*）/, '') === s)?.[0])
  const ok = [], bad = []
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const [who, cat, amt, ...rest] = line.split(/[,\t，]/).map(x => x.trim())
    const e = byNo.get(who) || byName.get(who)
    const c = catOf(cat || '')
    const a = Number(String(amt || '').replace(/[,，¥￥\s]/g, ''))
    if (!e) bad.push({ line: i + 1, text: line, error: byName.get(who) === null ? '重名，请写工号' : '找不到这个人' })
    else if (!c) bad.push({ line: i + 1, text: line, error: `不认识的类别：${cat || ''}` })
    else if (!Number.isFinite(a) || a < 0) bad.push({ line: i + 1, text: line, error: '金额不对' })
    else ok.push({ userId: e.id, name: e.name, category: c, amount: money(a), note: rest.join(' ') || null })
  })
  if (preview || bad.length) return { month, ok, bad, total: summarize(ok).amount }
  for (const r of ok) {
    await prisma.costItem.upsert({
      where: { userId_month_category: { userId: r.userId, month, category: r.category } },
      create: { userId: r.userId, month, category: r.category, amount: r.amount, note: r.note, source: 'IMPORT', updatedBy: ctx.user.id },
      update: { amount: r.amount, note: r.note, source: 'IMPORT', updatedBy: ctx.user.id }
    })
  }
  audit(ctx, 'cost.import', { entityType: 'month', entityId: month, detail: { count: ok.length } })
  return { month, ok, bad, total: summarize(ok).amount, saved: ok.length }
}

/** 一个人的成本：近 12 个月、今年累计、按类别、标准成本（画像用） */
export async function personCost(ctx, userId) {
  const scope = await costScope(ctx)
  if (!inScope(scope, userId)) return null
  const now = (await today()).slice(0, 7)
  const months = lastMonths(now, 12)
  const year = now.slice(0, 4)
  const [items, profile] = await Promise.all([
    prisma.costItem.findMany({ where: { userId: Number(userId), month: { gte: months[0] < `${year}-01` ? months[0] : `${year}-01`, lte: now } } }),
    prisma.costProfile.findUnique({ where: { userId: Number(userId) } })
  ])
  const ytd = summarize(items.filter(i => i.month.startsWith(year)))
  const last12 = summarize(items.filter(i => i.month >= months[0]))
  return {
    months: months.map(m => ({ month: m, amount: last12.byMonth[m] || 0 })),
    ytd: ytd.amount, ytdByCategory: ytd.byCategory, last12: last12.amount,
    monthlyAvg: money(last12.amount / Math.max(1, months.filter(m => last12.byMonth[m]).length)),
    profile: profileDto(profile), categories: CATEGORIES, canEdit: scope.all
  }
}

/** 汇总：按部门、按月、按类别（人员全景用）。year 默认今年 */
export async function costSummary(ctx, { year } = {}) {
  const scope = await costScope(ctx)
  if (!scope.all && !scope.ids.size) return null
  const y = String(year || (await today()).slice(0, 4))
  const items = await prisma.costItem.findMany({ where: { month: { startsWith: y }, ...(scope.all ? {} : { userId: { in: [...scope.ids] } }) } })
  const emps = new Map((await prisma.employee.findMany({ where: { id: { in: [...new Set(items.map(i => i.userId))] } } })).map(e => [e.id, e]))
  const s = summarize(items)
  const byDept = {}
  for (const [uid, amount] of s.byUser) {
    const d = emps.get(uid)?.deptPath || '未分部门'
    byDept[d] = money((byDept[d] || 0) + amount)
  }
  return { year: y, total: s.amount, byCategory: s.byCategory, byMonth: s.byMonth, byDept, byUser: Object.fromEntries(s.byUser), categories: CATEGORIES }
}
