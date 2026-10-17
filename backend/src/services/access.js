// 应用内的权限：平台只告诉我们「他是谁」，能看谁、能批谁在这里判断。没配置过的人默认只能看自己
//   人事（HR）：平台管理员，或在「设置 → 人事成员」里加的人 —— 看全部、管假期和设置
//   部门负责人：平台部门的负责人（统一登录带来的 leaderOf）—— 看本部门及下级部门的人
//   员工：只看自己
import { prisma } from '../lib/prisma.js'
import { forbidden } from '../lib/http.js'
import { getSettings } from './settings.js'

export async function isHr(ctx) {
  if (!ctx.user) return false
  if (ctx.user.roles?.includes('ADMIN')) return true
  if (ctx._hr !== undefined) return ctx._hr
  ctx._hr = !!(await prisma.roleMember.findUnique({ where: { userId_role: { userId: ctx.user.id, role: 'HR' } } }))
  return ctx._hr
}

export async function requireHr(ctx) {
  if (!(await isHr(ctx))) throw forbidden('只有人事能做这个操作')
}

/** 部门 id → 完整路径（从员工的部门里收集） */
export function deptPaths(employees) {
  const m = new Map()
  for (const e of employees) for (const d of e.depts || []) if (d.id && d.path) m.set(d.id, d.path)
  return m
}

/** 以 leaderOf 为根的部门路径下的员工（含下级部门），不含已离职的 */
export function membersUnder(leaderOf, employees) {
  const paths = deptPaths(employees)
  const roots = (leaderOf || []).map(id => paths.get(id)).filter(Boolean)
  const ids = new Set(leaderOf || [])
  if (!roots.length && !ids.size) return []
  return employees.filter(e => e.active && (e.depts || []).some(d =>
    ids.has(d.id) || roots.some(r => d.path === r || d.path?.startsWith(r + '/'))))
}

/**
 * 当前用户能看到的员工。返回 { all: true } 或 { ids: Set }
 * 人事看全部；负责人看自己 + 下属；其余只看自己
 */
export async function visibleScope(ctx) {
  if (await isHr(ctx)) return { all: true, ids: null }
  const ids = new Set([ctx.user.id])
  if (ctx.user.leaderOf?.length) {
    const emps = await prisma.employee.findMany({ where: { active: true }, select: { id: true, depts: true, active: true } })
    for (const e of membersUnder(ctx.user.leaderOf, emps)) ids.add(e.id)
  }
  return { all: false, ids }
}

export async function canSee(ctx, userId) {
  const s = await visibleScope(ctx)
  return s.all || s.ids.has(Number(userId))
}

/** 下属（不含本人）；人事返回 { all: true } */
async function subordinates(ctx) {
  const s = await visibleScope(ctx)
  if (s.all) return s
  s.ids.delete(ctx.user.id)
  return s
}

/** 合同：人事看全部；负责人看下属（设置里能关）；每个人看自己的 */
export async function contractScope(ctx) {
  if (await isHr(ctx)) return { all: true, ids: null }
  const ids = new Set([ctx.user.id])
  if ((await getSettings()).leaderSeeContracts) for (const id of (await subordinates(ctx)).ids) ids.add(id)
  return { all: false, ids }
}

/** 人员成本：人事看全部；负责人看下属（设置里能关）；本人看不到自己的 */
export async function costScope(ctx) {
  if (await isHr(ctx)) return { all: true, ids: null }
  if (!(await getSettings()).leaderSeeCost) return { all: false, ids: new Set() }
  return subordinates(ctx)
}

/** 能给谁记 1v1：人事给任何人，负责人给下属；不能给自己记 */
export async function canLog1v1(ctx, userId) {
  const uid = Number(userId)
  if (uid === ctx.user.id) return false
  const s = await visibleScope(ctx)
  return s.all || s.ids.has(uid)
}

export const inScope = (scope, userId) => scope.all || scope.ids.has(Number(userId))
export const scopeWhere = (scope, field = 'userId') => (scope.all ? {} : { [field]: { in: [...scope.ids] } })

/** 能看团队（负责人或人事）才显示「团队」类页面 */
export async function canSeeTeam(ctx) {
  return (await isHr(ctx)) || !!ctx.user.leaderOf?.length
}
