// 1v1 记录：负责人给下属记（人事给任何人记）。谁能看：
//   记录人、他上面的负责人、人事：全部（私人备注只有记录人和人事）
//   本人：标了「本人可见」的纪要和待办（看不到私人备注），可以勾掉自己的待办
// 纪要是敏感内容：留痕和上报平台的使用数据里不放原文
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { diffDays, isDateStr } from '../lib/dates.js'
import { canLog1v1, isHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { today } from './contracts.js'
import { getSettings } from './settings.js'

export const TOPICS = ['工作进展', '目标与优先级', '困难与支持', '反馈', '成长与学习', '职业发展', '团队协作', '状态与生活']
const OWNERS = { EMPLOYEE: '本人', MANAGER: '负责人' }

/** 当前用户对这条记录的权限：none / own（本人看共享部分）/ full（看全部，不含私人备注）/ author（含私人备注，可改） */
async function accessOf(ctx, m) {
  if (m.managerId === ctx.user.id) return 'author'
  if (await isHr(ctx)) return 'author'
  if (m.userId === ctx.user.id) return m.shared ? 'own' : 'none'
  const s = await visibleScope(ctx)
  return s.ids.has(m.userId) ? 'full' : 'none'
}

function dto(m, level, names) {
  const actions = (Array.isArray(m.actions) ? m.actions : []).map((a, i) => ({ index: i, text: a.text, owner: a.owner, ownerLabel: OWNERS[a.owner] || '', due: a.due || null, done: !!a.done }))
  return {
    id: m.id, userId: m.userId, managerId: m.managerId, employee: names.get(m.userId) || null, manager: names.get(m.managerId) || null,
    date: m.date, minutes: m.minutes, mood: level === 'own' ? null : m.mood, topics: m.topics || [], notes: m.notes, actions,
    privateNote: level === 'author' ? m.privateNote : undefined, nextDate: m.nextDate, shared: m.shared,
    canEdit: level === 'author', updatedAt: m.updatedAt
  }
}

async function briefMap(ids) {
  const rows = await prisma.employee.findMany({ where: { id: { in: [...new Set(ids)] } } })
  return new Map(rows.map(e => [e.id, employeeBrief(e)]))
}

/** 某人的 1v1 记录（userId 不给 = 自己），按日期倒序 */
export async function listFor(ctx, { userId } = {}) {
  const uid = Number(userId) || ctx.user.id
  const rows = await prisma.oneOnOne.findMany({ where: { userId: uid, deletedAt: null }, orderBy: [{ date: 'desc' }, { id: 'desc' }] })
  const out = []
  for (const m of rows) {
    const level = await accessOf(ctx, m)
    if (level !== 'none') out.push([m, level])
  }
  if (uid !== ctx.user.id && !out.length && !(await canLog1v1(ctx, uid))) throw forbidden('只能看自己和下属的 1v1')
  const names = await briefMap(out.flatMap(([m]) => [m.userId, m.managerId]))
  return { employee: (await briefMap([uid])).get(uid) || null, rows: out.map(([m, l]) => dto(m, l, names)), canLog: await canLog1v1(ctx, uid), topics: TOPICS }
}

/** 统计：每人最近一次 1v1、待办没完成的条数（人员全景、画像用）。userIds 不给 = 全部 */
export async function stats(userIds) {
  const rows = await prisma.oneOnOne.findMany({ where: { deletedAt: null, ...(userIds ? { userId: { in: userIds } } : {}) }, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: { userId: true, date: true, mood: true, actions: true, nextDate: true } })
  const m = new Map()
  for (const r of rows) {
    const s = m.get(r.userId) || { last: null, count: 0, openActions: 0, moods: [] }
    if (!s.last) s.last = { date: r.date, mood: r.mood, nextDate: r.nextDate }
    s.count++
    if (s.moods.length < 6 && r.mood != null) s.moods.unshift({ date: r.date, mood: r.mood })
    s.openActions += (Array.isArray(r.actions) ? r.actions : []).filter(a => !a.done).length
    m.set(r.userId, s)
  }
  return m
}

/** 我的 1v1 名单：能记 1v1 的人（负责人 = 下属，人事 = 全部），带最近一次、下次、是否超期 */
export async function roster(ctx, { keyword } = {}) {
  const scope = await visibleScope(ctx)
  let emps = await prisma.employee.findMany({ where: { active: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  emps = emps.filter(e => e.id !== ctx.user.id)
  const k = String(keyword || '').trim()
  if (k) emps = emps.filter(e => e.name.includes(k) || e.jobNumber?.includes(k) || e.deptPath?.includes(k))
  const st = await stats(emps.map(e => e.id))
  const day = await today()
  const cadence = (await getSettings()).oneOnOneCadenceDays
  const rows = emps.map(e => {
    const s = st.get(e.id)
    const since = s?.last ? diffDays(s.last.date, day) : null
    return {
      employee: employeeBrief(e), count: s?.count || 0, last: s?.last || null, sinceDays: since, openActions: s?.openActions || 0,
      // 不参与考核的人（如董事）不催 1v1
      overdue: e.exemption !== 'FULL' && cadence > 0 && (since == null || since > cadence), nextDue: s?.last?.nextDate && s.last.nextDate <= day
    }
  })
  rows.sort((a, b) => (b.overdue - a.overdue) || ((b.sinceDays ?? 1e9) - (a.sinceDays ?? 1e9)))
  return { rows, cadence, isHr: scope.all }
}

function cleanActions(list) {
  if (!Array.isArray(list)) return []
  return list.filter(a => a && String(a.text || '').trim()).slice(0, 30).map(a => {
    if (a.due && !isDateStr(a.due)) throw badRequest('待办的期限要写 YYYY-MM-DD')
    return { text: String(a.text).trim().slice(0, 300), owner: OWNERS[a.owner] ? a.owner : 'EMPLOYEE', due: a.due || null, done: !!a.done }
  })
}

/** 新建或修改（body.id 有值是改，只有记录人和人事能改） */
export async function save(ctx, body = {}) {
  const id = body.id ? Number(body.id) : null
  const cur = id ? await prisma.oneOnOne.findFirst({ where: { id, deletedAt: null } }) : null
  if (id && !cur) throw notFound('没有这条记录')
  if (cur && (await accessOf(ctx, cur)) !== 'author') throw forbidden('只有记录人和人事能改')
  const userId = cur ? cur.userId : Number(body.userId)
  if (!cur && !(await canLog1v1(ctx, userId))) throw forbidden('只能给自己的下属记 1v1（人事能给任何人记）')
  if (!isDateStr(body.date || cur?.date)) throw badRequest('日期要写 YYYY-MM-DD')
  if (body.nextDate && !isDateStr(body.nextDate)) throw badRequest('下次时间要写 YYYY-MM-DD')
  const mood = body.mood == null || body.mood === '' ? null : Number(body.mood)
  if (mood != null && !(Number.isInteger(mood) && mood >= 1 && mood <= 5)) throw badRequest('状态是 1 ~ 5')
  const data = {
    date: body.date || cur.date,
    minutes: body.minutes ? Math.min(600, Math.max(1, Math.round(Number(body.minutes)))) : null,
    mood,
    topics: Array.isArray(body.topics) ? body.topics.map(t => String(t).slice(0, 20)).slice(0, 12) : [],
    notes: body.notes ? String(body.notes).slice(0, 20000) : null,
    privateNote: body.privateNote ? String(body.privateNote).slice(0, 20000) : null,
    actions: cleanActions(body.actions),
    nextDate: body.nextDate || null,
    shared: body.shared !== false
  }
  const m = cur
    ? await prisma.oneOnOne.update({ where: { id }, data })
    : await prisma.oneOnOne.create({ data: { ...data, userId, managerId: ctx.user.id } })
  audit(ctx, cur ? 'one_on_one.update' : 'one_on_one.create', { entityType: 'employee', entityId: userId, detail: { id: m.id, date: m.date, shared: m.shared } })
  const names = await briefMap([m.userId, m.managerId])
  return dto(m, 'author', names)
}

export async function remove(ctx, id) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m) throw notFound('没有这条记录')
  if ((await accessOf(ctx, m)) !== 'author') throw forbidden('只有记录人和人事能删')
  await prisma.oneOnOne.update({ where: { id: m.id }, data: { deletedAt: new Date() } })
  audit(ctx, 'one_on_one.remove', { entityType: 'employee', entityId: m.userId, detail: { id: m.id } })
  return { ok: true }
}

/** 勾掉 / 取消一项待办：记录人、人事；本人只能勾「本人」的 */
export async function toggleAction(ctx, id, { index, done } = {}) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m) throw notFound('没有这条记录')
  const level = await accessOf(ctx, m)
  const actions = Array.isArray(m.actions) ? [...m.actions] : []
  const a = actions[Number(index)]
  if (!a) throw badRequest('没有这项待办')
  if (!(level === 'author' || (level === 'own' && a.owner === 'EMPLOYEE'))) throw forbidden('不能改这项待办')
  actions[Number(index)] = { ...a, done: !!done }
  await prisma.oneOnOne.update({ where: { id: m.id }, data: { actions } })
  audit(ctx, 'one_on_one.action', { entityType: 'employee', entityId: m.userId, detail: { id: m.id, done: !!done } })
  return { ok: true }
}
