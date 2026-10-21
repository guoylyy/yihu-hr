// 人员：档案（人事填）、个人画像、人员全景（公司 / 部门的人员蓝图）
// 能看谁走 access.js：人事看全部，负责人看本人和下属，员工只看自己；合同、成本再各按自己的范围收敛
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { addDays, isDateStr } from '../lib/dates.js'
import { money } from '../lib/cost.js'
import { TENURE_BUCKETS, flagsFor, tenure, tenureBucket, yearsBetween } from '../lib/portrait.js'
import { canLog1v1, canSee, contractScope, costScope, inScope, isHr, requireHr, visibleScope } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { contractDto, contractsOf, today } from './contracts.js'
import { costSummary, personCost } from './cost.js'
import { stats as oneOnOneStats } from './oneOnOne.js'
import { balanceOf } from './leave.js'
import { leaveUsedByType } from './absences.js'
import { getSettings } from './settings.js'
import { EXEMPTIONS, attendanceExempt } from '../lib/exemption.js'

export const EMPLOYMENT = { FULL_TIME: '全职', INTERN: '实习', PART_TIME: '兼职', OUTSOURCED: '外包', REHIRED: '退休返聘' }
export const EDUCATION = ['高中及以下', '大专', '本科', '硕士', '博士']
const DATE_FIELDS = ['hireDate', 'workStartDate', 'regularDate', 'leaveDate', 'birthDate']
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null)

/** 档案字段：人事看全部；其他人不给出生日期（只给年龄） */
function profileDto(e, day, hr) {
  return {
    ...employeeBrief(e), title: e.title, depts: (e.depts || []).map(d => d.path || d.name),
    hireDate: ymd(e.hireDate), workStartDate: ymd(e.workStartDate), regularDate: ymd(e.regularDate), leaveDate: ymd(e.leaveDate),
    employmentType: e.employmentType, employmentLabel: EMPLOYMENT[e.employmentType] || null, level: e.level,
    gender: e.gender, birthDate: hr ? ymd(e.birthDate) : undefined, age: e.birthDate ? yearsBetween(e.birthDate, day) : null,
    education: e.education, school: e.school, major: e.major, tags: Array.isArray(e.tags) ? e.tags : [],
    tenure: tenure(e.hireDate, day), workYears: e.workStartDate ? yearsBetween(e.workStartDate, day) : null,
    exemption: e.exemption || null, exemptionLabel: EXEMPTIONS[e.exemption] || null, exemptNote: e.exemptNote || null
  }
}

/** 豁免的取值校验：空 / NONE = 正常 */
function checkExemption(v) {
  if (!v || v === 'NONE') return null
  if (!EXEMPTIONS[v]) throw badRequest('豁免只能是 ATTENDANCE（免考勤）或 FULL（免考勤、不参与考核）')
  return v
}

/** 人事批量设考勤 / 考核豁免（人员全景里勾选几个人设） */
export async function setExemption(ctx, { userIds = [], exemption, note } = {}) {
  await requireHr(ctx)
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))]
  if (!ids.length) throw badRequest('选几个人')
  const value = checkExemption(exemption)
  const r = await prisma.employee.updateMany({ where: { id: { in: ids } }, data: { exemption: value, exemptNote: value ? (note ? String(note).trim().slice(0, 100) : null) : null } })
  audit(ctx, 'employee.exemption', { entityType: 'employee', detail: { count: r.count, exemption: value || 'NONE' } })
  return { updated: r.count }
}

/** 人事改档案 */
export async function updateProfile(ctx, id, body = {}) {
  await requireHr(ctx)
  const emp = await prisma.employee.findUnique({ where: { id: Number(id) } })
  if (!emp) throw notFound('没有这个员工')
  const data = {}
  for (const k of DATE_FIELDS) {
    if (body[k] === undefined) continue
    if (body[k] && !isDateStr(body[k])) throw badRequest('日期格式是 YYYY-MM-DD')
    data[k] = body[k] ? new Date(body[k] + 'T00:00:00Z') : null
  }
  if (body.employmentType !== undefined) {
    if (body.employmentType && !EMPLOYMENT[body.employmentType]) throw badRequest('用工类型不对')
    data.employmentType = body.employmentType || null
  }
  if (body.gender !== undefined) {
    if (body.gender && !['M', 'F'].includes(body.gender)) throw badRequest('性别不对')
    data.gender = body.gender || null
  }
  if (body.education !== undefined) {
    if (body.education && !EDUCATION.includes(body.education)) throw badRequest('学历不对')
    data.education = body.education || null
  }
  if (body.exemption !== undefined) {
    data.exemption = checkExemption(body.exemption)
    if (!data.exemption) data.exemptNote = null
  }
  if (body.exemptNote !== undefined && data.exemption !== null) data.exemptNote = body.exemptNote ? String(body.exemptNote).trim().slice(0, 100) : null
  for (const [k, n] of [['level', 20], ['school', 100], ['major', 100]]) if (body[k] !== undefined) data[k] = body[k] ? String(body[k]).trim().slice(0, n) : null
  if (body.tags !== undefined) data.tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(t => String(t).trim().slice(0, 20)).filter(Boolean))].slice(0, 20) : []
  const u = await prisma.employee.update({ where: { id: emp.id }, data })
  audit(ctx, 'employee.profile', { entityType: 'employee', entityId: emp.id, detail: { fields: Object.keys(data) } })
  return profileDto(u, await today(), true)
}

/** 近 30 天有考勤异常记录的天数：Map(userId → 天数) */
async function abnormalDays(userIds, day) {
  const rows = await prisma.punch.findMany({
    where: { userId: { in: userIds }, workDate: { gte: addDays(day, -30), lte: day }, result: { notIn: ['NORMAL', 'OTHER'] } },
    select: { userId: true, workDate: true }
  })
  const m = new Map()
  for (const r of rows) m.set(r.userId, (m.get(r.userId) || new Set()).add(r.workDate))
  return new Map([...m].map(([k, v]) => [k, v.size]))
}

/** 个人画像：档案、合同、成本、考勤、假期、1v1、要留意的事（id 给 'me' 或不给 = 自己） */
export async function portrait(ctx, id) {
  const uid = !id || id === 'me' ? ctx.user.id : Number(id)
  if (!(await canSee(ctx, uid))) throw forbidden('只能看自己和下属')
  const emp = await prisma.employee.findUnique({ where: { id: uid } })
  if (!emp) throw notFound('没有这个员工')
  const s = await getSettings()
  const day = await today()
  const hr = await isHr(ctx)
  const self = uid === ctx.user.id
  const seeContracts = inScope(await contractScope(ctx), uid)
  const [contracts, st, abn, cost, leaveByType, bal] = await Promise.all([
    contractsOf([uid]).then(m => m.get(uid) || []),
    oneOnOneStats([uid]).then(m => m.get(uid) || null),
    abnormalDays([uid], day).then(m => m.get(uid) || 0),
    personCost(ctx, uid),
    leaveUsedByType(uid, Number(day.slice(0, 4))),
    balanceOf(uid, Number(day.slice(0, 4)))
  ])
  const allTypes = await prisma.leaveType.findMany()
  const types = new Map(allTypes.map(t => [t.code, t.name]))
  const balanced = new Set(allTypes.filter(t => t.balanced).map(t => t.code))
  // 员工自己看画像：不显示「要留意的事」（那是给人事和负责人的）
  const flags = self && !hr ? [] : flagsFor({ employee: { ...emp, leaveDate: ymd(emp.leaveDate) }, contracts, last1v1: st?.last, openActions: st?.openActions || 0, abnormalDays: abn, today: day, settings: s })
  return {
    profile: profileDto(emp, day, hr),
    flags,
    contracts: seeContracts ? contracts.map(c => ({ ...contractDto(c, { emp, day, warnDays: s.contractWarnDays }), renewed: contracts.some(x => x.renewOfId === c.id) })) : null,
    cost,
    attendance: { abnormalDays30: abn },
    leave: { usedThisYear: leaveByType, balances: Object.fromEntries(Object.entries(bal).filter(([k]) => balanced.has(k)).map(([k, v]) => [types.get(k) || k, v.available])) },
    oneOnOne: st ? { count: st.count, last: self && !hr ? { date: st.last.date } : st.last, openActions: st.openActions, moods: self && !hr ? [] : st.moods } : { count: 0, last: null, openActions: 0, moods: [] },
    can: { editProfile: hr, editContracts: hr, editCost: !!cost?.canEdit, log1v1: await canLog1v1(ctx, uid) }
  }
}

/**
 * 人员全景：能看的人（人事 = 全公司，负责人 = 本人和下属）的结构、风险、成本、1v1 覆盖
 * 返回指标、按部门、分布和人员名单（带标记），名单可按部门 / 关键字 / 标记筛
 */
export async function overview(ctx, { keyword, dept, flag } = {}) {
  const scope = await visibleScope(ctx)
  if (!scope.all && scope.ids.size <= 1) throw forbidden('人员全景给人事和部门负责人看')
  const s = await getSettings()
  const day = await today()
  const year = day.slice(0, 4)
  const all = await prisma.employee.findMany({ where: scope.all ? {} : { id: { in: [...scope.ids] } }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  const active = all.filter(e => e.active && !(e.leaveDate && ymd(e.leaveDate) < day))
  const ids = all.map(e => e.id)
  const cScope = await contractScope(ctx)
  // 成本：名单里每人照常显示自己的；指标、图表不算不参与考核的人
  const [contracts, oneStats, abn, costAll, cost] = await Promise.all([contractsOf(ids), oneOnOneStats(ids), abnormalDays(ids, day), costSummary(ctx, { year }), costSummary(ctx, { year, excludeExempt: true })])
  const cost$ = await costScope(ctx)
  const hr = scope.all
  const people = all.map(e => {
    const cs = contracts.get(e.id) || []
    const st = oneStats.get(e.id)
    const seeC = inScope(cScope, e.id)
    let flags = flagsFor({ employee: { ...e, leaveDate: ymd(e.leaveDate) }, contracts: cs, last1v1: st?.last, openActions: st?.openActions || 0, abnormalDays: abn.get(e.id) || 0, today: day, settings: s })
    if (!seeC) flags = flags.filter(f => !['NO_LABOR', 'LABOR_EXPIRING', 'PROBATION_ENDING', 'NO_CONFIDENTIALITY', 'NC_IN_FORCE'].includes(f.code))
    const left = !active.includes(e)
    return {
      employee: employeeBrief(e), dept: e.deptPath || '未分部门', title: e.title, level: e.level,
      employment: EMPLOYMENT[e.employmentType] || null, left,
      tenure: tenure(e.hireDate, day), age: e.birthDate ? yearsBetween(e.birthDate, day) : null, education: e.education,
      hireDate: ymd(e.hireDate), leaveDate: ymd(e.leaveDate),
      last1v1: st?.last?.date || null, mood: st?.last?.mood ?? null, openActions: st?.openActions || 0,
      costYtd: inScope(cost$, e.id) && costAll ? costAll.byUser[e.id] || 0 : null,
      exemption: e.exemption || null, exemptNote: e.exemptNote || null,
      flags
    }
  })
  // 指标、按部门、分布只算参与考核的在职人员（不参与考核的如董事单独计数，见 tiles.exempt）
  const current = people.filter(p => !p.left && p.exemption !== 'FULL')
  const counted = people.filter(p => p.exemption !== 'FULL')
  // 指标
  const n = current.length
  const withTenure = current.filter(p => p.tenure != null)
  const cadence = s.oneOnOneCadenceDays
  const covered = current.filter(p => p.last1v1 && (!cadence || addDays(p.last1v1, cadence) >= day)).length
  const has = (p, code) => p.flags.some(f => f.code === code)
  const tiles = {
    headcount: n,
    joinedThisYear: counted.filter(p => p.hireDate?.startsWith(year)).length,
    leftThisYear: counted.filter(p => p.leaveDate?.startsWith(year) && p.leaveDate <= day).length,
    avgTenure: withTenure.length ? Math.round(withTenure.reduce((a, p) => a + p.tenure, 0) / withTenure.length * 10) / 10 : null,
    avgAge: current.filter(p => p.age != null).length ? Math.round(current.filter(p => p.age != null).reduce((a, p) => a + p.age, 0) / current.filter(p => p.age != null).length) : null,
    contractsExpiring: current.filter(p => has(p, 'LABOR_EXPIRING')).length,
    noLabor: current.filter(p => has(p, 'NO_LABOR')).length,
    probationEnding: current.filter(p => has(p, 'PROBATION_ENDING')).length,
    nonCompeteInForce: people.filter(p => has(p, 'NC_IN_FORCE')).length,
    oneOnOneCoverage: n ? Math.round(covered / n * 100) : null,
    lowMood: current.filter(p => has(p, 'LOW_MOOD')).length,
    costYtd: cost ? cost.total : null,
    // 人均只除以能看到成本的人（负责人看不到自己的）
    costPerHead: cost && current.some(p => p.costYtd != null) ? money(current.reduce((a, p) => a + (p.costYtd || 0), 0) / current.filter(p => p.costYtd != null).length) : null,
    risk: current.filter(p => p.flags.some(f => f.level === 'risk')).length,
    // 豁免的在职人数：免考勤（指标照算）、不参与考核（指标不算）
    attendanceExempt: people.filter(p => !p.left && p.exemption === 'ATTENDANCE').length,
    exempt: people.filter(p => !p.left && p.exemption === 'FULL').length
  }
  // 按部门
  const depts = {}
  for (const p of current) {
    const d = depts[p.dept] || (depts[p.dept] = { dept: p.dept, headcount: 0, tenureSum: 0, tenureN: 0, risk: 0, warn: 0, covered: 0, costYtd: cost ? 0 : null, costN: 0 })
    d.headcount++
    if (p.costYtd != null) { d.costN++; if (d.costYtd != null) d.costYtd = money(d.costYtd + p.costYtd) }
    if (p.tenure != null) { d.tenureSum += p.tenure; d.tenureN++ }
    if (p.flags.some(f => f.level === 'risk')) d.risk++
    if (p.flags.some(f => f.level === 'warn')) d.warn++
    if (p.last1v1 && (!cadence || addDays(p.last1v1, cadence) >= day)) d.covered++
  }
  const byDept = Object.values(depts).map(d => ({
    dept: d.dept, headcount: d.headcount, avgTenure: d.tenureN ? Math.round(d.tenureSum / d.tenureN * 10) / 10 : null,
    risk: d.risk, warn: d.warn, oneOnOneCoverage: Math.round(d.covered / d.headcount * 100),
    costYtd: d.costYtd, costPerHead: d.costYtd != null && d.costN ? money(d.costYtd / d.costN) : null
  })).sort((a, b) => b.headcount - a.headcount)
  // 分布
  const dist = (fn, order) => {
    const m = {}
    for (const p of current) { const k = fn(p) ?? '未填'; m[k] = (m[k] || 0) + 1 }
    const keys = order ? [...order.filter(k => m[k]), ...Object.keys(m).filter(k => !order.includes(k))] : Object.keys(m).sort((a, b) => m[b] - m[a])
    return keys.map(k => ({ key: k, count: m[k] }))
  }
  const tenureLabel = Object.fromEntries(TENURE_BUCKETS.map(([k, l]) => [k, l]))
  const distributions = {
    tenure: dist(p => (p.tenure == null ? null : tenureLabel[tenureBucket(p.tenure)]), TENURE_BUCKETS.map(b => b[1])),
    education: dist(p => p.education, EDUCATION),
    employment: dist(p => p.employment, Object.values(EMPLOYMENT)),
    age: dist(p => (p.age == null ? null : p.age < 25 ? '25 岁以下' : p.age < 30 ? '25 ~ 29' : p.age < 35 ? '30 ~ 34' : p.age < 40 ? '35 ~ 39' : p.age < 50 ? '40 ~ 49' : '50 岁以上'), ['25 岁以下', '25 ~ 29', '30 ~ 34', '35 ~ 39', '40 ~ 49', '50 岁以上'])
  }
  // 名单筛选
  let list = people
  if (dept) list = list.filter(p => p.dept === dept || p.dept.startsWith(dept + '/'))
  const k = String(keyword || '').trim()
  if (k) list = list.filter(p => p.employee.name.includes(k) || p.employee.jobNumber?.includes(k) || p.dept.includes(k) || p.level?.includes(k))
  if (flag === 'LEFT') list = list.filter(p => p.left)
  else {
    list = list.filter(p => !p.left)
    if (flag === 'ANY') list = list.filter(p => p.flags.some(f => f.level !== 'info'))
    else if (flag === 'EXEMPT') list = list.filter(p => p.exemption)
    else if (flag) list = list.filter(p => has(p, flag))
  }
  return {
    today: day, year, tiles, byDept, distributions, people: list,
    cost: cost ? { byCategory: cost.byCategory, byMonth: cost.byMonth, categories: cost.categories } : null,
    seeCost: !!cost, seeContracts: cScope.all || cScope.ids.size > 1, isHr: hr, cadence
  }
}

