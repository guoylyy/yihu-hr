// 员工 = 平台用户主数据的本地副本。每小时增量、每天全量从 /api/open/users 拉；对人以平台为准，应用里不改姓名部门。
// 拉完之后再从钉钉 / 飞书补全档案（入职日期、工号……，见 services/profileSync.js）
import { prisma } from '../lib/prisma.js'
import { fetchUsers, ws } from '../lib/platform.js'

function fromPlatform(u) {
  const depts = (u.depts || []).map(d => ({ id: d.id, name: d.name, path: d.path || d.name, isPrimary: !!d.isPrimary }))
  const primary = depts.find(d => d.isPrimary) || depts[0]
  return {
    // 平台没有工号时不清掉这里的（可能是从钉钉 / 飞书补全来的）；平台有就以平台为准
    name: u.name, ...(u.jobNumber ? { jobNumber: u.jobNumber } : {}), title: u.title || null, avatar: u.avatar || null, spaceId: u.spaceId || 1,
    depts, deptId: primary?.id ?? null, deptPath: primary?.path ?? null, active: !!u.active,
    dingUserId: u.dingUserId || null, feishuOpenId: u.feishuOpenId || null, wecomUserId: u.wecomUserId || null, syncedAt: new Date()
  }
}

/** full：全量（顺带把平台上已删除的人标成离职）；否则按上次同步时间增量 */
export async function syncDirectory({ full = false, trigger = 'AUTO' } = {}) {
  if (!ws.enabled) return { skipped: '未接入平台（本地开发模式）' }
  const run = await prisma.syncRun.create({ data: { source: 'DIRECTORY', trigger } })
  try {
    // 增量：从上一次成功同步开始的时间算（不能用员工表里最新的 syncedAt：本人登录时会先建一条，会把时间推后、漏掉别人的改动）
    const last = full ? null : await prisma.syncRun.findFirst({ where: { source: 'DIRECTORY', ok: true, id: { not: run.id } }, orderBy: { id: 'desc' } })
    // 往前多拉 10 分钟，避免时钟差漏人
    const since = last ? new Date(last.startedAt.getTime() - 600_000) : null
    const data = await fetchUsers({ updatedSince: since })
    for (const u of data.list) {
      const row = fromPlatform(u)
      // feishuOpenId 变了（换了飞书应用），换来的 user_id 作废
      const old = await prisma.employee.findUnique({ where: { id: u.id }, select: { feishuOpenId: true } })
      if (old && old.feishuOpenId !== row.feishuOpenId) row.feishuUserId = null
      await prisma.employee.upsert({ where: { id: u.id }, create: { id: u.id, ...row }, update: row })
    }
    let removed = 0
    if (full) {
      const seen = data.list.map(u => u.id)
      removed = (await prisma.employee.updateMany({ where: { id: { notIn: seen.length ? seen : [0] }, active: true }, data: { active: false } })).count
    }
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: true, fetched: data.list.length, saved: data.list.length, finishedAt: new Date(), error: removed ? `平台上已不在本空间的 ${removed} 人标为离职` : null } })
    return { fetched: data.list.length, removed }
  } catch (e) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: false, error: e.message, finishedAt: new Date() } })
    throw e
  }
}

const seen = new Map()
/**
 * 登录用户来访时顺手记下他的负责部门（leaderOf 只在统一登录里有，用户主数据里没有）。
 * 员工还没同步过来时先建一条，等通讯录同步补全
 */
export async function touchEmployee(user) {
  if (!user?.id) return
  const key = `${user.id}:${JSON.stringify(user.leaderOf || [])}`
  if (seen.get(user.id) === key) return
  seen.set(user.id, key)
  const leaderOf = Array.isArray(user.leaderOf) ? user.leaderOf : []
  try {
    await prisma.employee.upsert({
      where: { id: user.id },
      create: { id: user.id, name: user.name || `用户${user.id}`, jobNumber: user.jobNumber || null, title: user.title || null, avatar: user.avatar || null, leaderOf, depts: (user.depts || []).map(d => ({ id: d.id, name: d.name, path: d.name, isPrimary: !!d.isPrimary })) },
      update: { leaderOf }
    })
  } catch (e) {
    seen.delete(user.id)
    console.warn(`[hr] 记录员工失败：${e.message}`)
  }
}

export function employeeBrief(e) {
  // exemption：考勤 / 考核豁免（lib/exemption.js），前端在名单里标出来
  return e ? { id: e.id, name: e.name, jobNumber: e.jobNumber, deptPath: e.deptPath, avatar: e.avatar, active: e.active, exemption: e.exemption || null } : null
}
