// 从钉钉 / 飞书补全档案：平台通讯录只给姓名、部门、工号（可能为空）这些；人事在钉钉智能人事 / 飞书里维护的
// 入职日期、转正日期、出生日期、性别、学历、用工类型……在这里读过来，和现有档案三方比对（lib/vendorProfile.js）：
//   空的补上；钉钉 / 飞书上改了的跟着改；这里改过而钉钉没改的保留；第一次比对两边不一样的记成冲突，人事在「设置 → 打卡同步」里选
// 每天跟着通讯录全量同步跑一次，也能手动跑。只读钉钉 / 飞书，不往回写。工号只补空的（平台有工号以平台为准）
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { PROVIDERS } from '../providers/index.js'
import { PROFILE_SYNC_FIELDS, mergeProfile } from '../lib/vendorProfile.js'
import { requireHr } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { getSettings } from './settings.js'

const DATE_KEYS = new Set(['hireDate', 'regularDate', 'workStartDate', 'birthDate'])
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const appValues = (e) => Object.fromEntries(Object.keys(PROFILE_SYNC_FIELDS).map(k => [k, DATE_KEYS.has(k) ? ymd(e[k]) : e[k] ?? null]))
const toDb = (k, v) => (DATE_KEYS.has(k) ? (v ? new Date(v + 'T00:00:00Z') : null) : v)

let running = false

/** 补全一遍。返回 { people, updated, filled, conflicts, notes } */
export async function syncProfiles({ trigger = 'AUTO' } = {}) {
  const s = await getSettings()
  if (trigger === 'AUTO' && !s.profileSync) return { skipped: '设置里关了从钉钉 / 飞书补全档案' }
  if (running) return { skipped: '正在补全' }
  running = true
  const run = await prisma.syncRun.create({ data: { source: 'PROFILE', trigger } })
  const stat = { people: 0, changedPeople: 0, filled: 0, updated: 0, conflicts: 0 }
  const notes = []
  try {
    const providers = PROVIDERS.filter(p => p.fetchProfiles && p.configured())
    if (!providers.length) notes.push('钉钉、飞书都没配好，没有可补全的来源')
    for (const p of providers) {
      // 快照最旧的人先读（钉钉没配花名册时一次只读一部分，轮着来）
      const emps = (await prisma.employee.findMany({ where: { active: true } }))
        .filter(e => p.profileIdOf(e))
        .sort((a, b) => String(a.vendorSnapshot?.[p.source]?.at || '').localeCompare(String(b.vendorSnapshot?.[p.source]?.at || '')))
      if (!emps.length) continue
      let data
      try {
        data = await p.fetchProfiles(emps.map(e => p.profileIdOf(e)), { agentId: s.dingAgentId, tz: s.timezone })
      } catch (e) {
        notes.push(`${p.label}：${e.message}（${p.profileHint}）`)
        continue
      }
      if (data.skipped) notes.push(`${p.label}：这次读了 ${data.size} 人，还有 ${data.skipped} 人下次接着读（配上 AgentId 读花名册就能一次读完）`)
      const open = await prisma.profileChange.findMany({ where: { source: p.source, kind: 'CONFLICT' } })
      for (const e of emps) {
        const vendor = { ...(data.get(p.profileIdOf(e)) || {}) }
        if (!data.has(p.profileIdOf(e))) continue
        stat.people++
        if (e.jobNumber) delete vendor.jobNumber
        const app = appValues(e)
        const snap = e.vendorSnapshot?.[p.source] || null
        const r = mergeProfile(app, snap, vendor)
        const at = new Date().toISOString()
        const mine = open.filter(c => c.userId === e.id)
        await prisma.$transaction(async (tx) => {
          await tx.employee.update({
            where: { id: e.id },
            data: { ...Object.fromEntries(Object.entries(r.set).map(([k, v]) => [k, toDb(k, v)])), vendorSnapshot: { ...(e.vendorSnapshot || {}), [p.source]: { ...vendor, at } } }
          })
          for (const [k, v] of Object.entries(r.set)) {
            await tx.profileChange.create({ data: { userId: e.id, source: p.source, field: k, before: app[k] ?? null, after: String(v), kind: 'APPLIED' } })
            // 这个字段原来有没处理的冲突：钉钉 / 飞书上又改了，以新的为准，冲突作废
            const stale = mine.filter(c => c.field === k).map(c => c.id)
            if (stale.length) await tx.profileChange.updateMany({ where: { id: { in: stale } }, data: { kind: 'RESOLVED', resolution: 'VENDOR', resolvedAt: new Date() } })
          }
          for (const c of r.conflicts) {
            const same = mine.find(x => x.field === c.field)
            if (same && same.after === String(c.vendor)) continue
            if (same) await tx.profileChange.delete({ where: { id: same.id } })
            await tx.profileChange.create({ data: { userId: e.id, source: p.source, field: c.field, before: String(c.app), after: String(c.vendor), kind: 'CONFLICT' } })
            stat.conflicts++
          }
        })
        const n = Object.keys(r.set).length
        if (n) stat.changedPeople++
        stat.updated += r.updated.length
        stat.filled += n - r.updated.length
      }
    }
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: true, fetched: stat.people, saved: stat.changedPeople, unmatched: stat.conflicts, error: notes.join('；').slice(0, 2000) || null, finishedAt: new Date() } })
    return { ...stat, notes }
  } catch (e) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: false, error: String(e.message).slice(0, 2000), finishedAt: new Date() } })
    throw e
  } finally {
    running = false
  }
}

/** 人事手动补全一遍 */
export async function manualSyncProfiles(ctx) {
  await requireHr(ctx)
  const r = await syncProfiles({ trigger: 'MANUAL' })
  audit(ctx, 'profile.sync', { detail: { people: r.people, filled: r.filled, updated: r.updated, conflicts: r.conflicts } })
  return r
}

/** 设置页：最近一次结果、待处理的冲突、最近的改动 */
export async function profileSyncStatus(ctx) {
  await requireHr(ctx)
  const [last, conflicts, recent] = await Promise.all([
    prisma.syncRun.findFirst({ where: { source: 'PROFILE' }, orderBy: { id: 'desc' } }),
    prisma.profileChange.findMany({ where: { kind: 'CONFLICT' }, orderBy: { id: 'asc' }, take: 500 }),
    prisma.profileChange.findMany({ where: { kind: 'APPLIED' }, orderBy: { id: 'desc' }, take: 100 })
  ])
  const emps = new Map((await prisma.employee.findMany({ where: { id: { in: [...new Set([...conflicts, ...recent].map(c => c.userId))] } } })).map(e => [e.id, e]))
  const dto = (c) => ({ id: c.id, employee: employeeBrief(emps.get(c.userId)), source: c.source, field: c.field, label: PROFILE_SYNC_FIELDS[c.field] || c.field, before: c.before, after: c.after, at: c.createdAt })
  const sources = PROVIDERS.filter(p => p.fetchProfiles).map(p => ({ source: p.source, label: p.label, configured: p.configured(), hint: p.profileHint }))
  return { last, sources, conflicts: conflicts.map(dto), recent: recent.map(dto), enabled: (await getSettings()).profileSync }
}

/** 处理冲突：use = VENDOR 用钉钉 / 飞书的，APP 保留这里的。ids 不给 = 全部 */
export async function resolveConflicts(ctx, { ids, use } = {}) {
  await requireHr(ctx)
  if (!['VENDOR', 'APP'].includes(use)) throw badRequest('选「用钉钉 / 飞书的」还是「保留这里的」')
  const rows = await prisma.profileChange.findMany({ where: { kind: 'CONFLICT', ...(Array.isArray(ids) && ids.length ? { id: { in: ids.map(Number) } } : {}) } })
  for (const c of rows) {
    await prisma.$transaction(async (tx) => {
      if (use === 'VENDOR') await tx.employee.update({ where: { id: c.userId }, data: { [c.field]: toDb(c.field, c.after) } })
      await tx.profileChange.update({ where: { id: c.id }, data: { kind: 'RESOLVED', resolution: use, resolvedBy: ctx.user.id, resolvedAt: new Date() } })
    })
  }
  audit(ctx, 'profile.resolve', { detail: { count: rows.length, use } })
  return { resolved: rows.length }
}
