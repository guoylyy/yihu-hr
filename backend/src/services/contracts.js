// 合同与协议：人事建、改、续签、解除；负责人看下属的（设置里能关），每个人看自己的
// 签好的文件放以虎 One 文件存储（七牛云）：浏览器拿上传凭证直传，下载走应用检查权限后跳限时地址
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { ws } from '../lib/platform.js'
import { dayInTz } from '../lib/dates.js'
import { KINDS, STATUS, TERMS, checkContract, contractStatus, daysLeft, restrictWindow } from '../lib/contracts.js'
import { contractScope, inScope, requireHr } from './access.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { getSettings } from './settings.js'

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null)
const FIELDS = ['kind', 'title', 'number', 'term', 'signedDate', 'startDate', 'endDate', 'probationEnd', 'restrictMonths', 'monthlyComp', 'serviceMonths', 'penalty', 'note']
const FILE_MAX_MB = 50

export async function today() {
  return dayInTz(new Date(), (await getSettings()).timezone)
}

/** 合同 → 接口返回的形状（带状态、剩余天数、竞业限制期） */
export function contractDto(c, { emp, day, warnDays }) {
  const leaveDate = ymd(emp?.leaveDate)
  const status = contractStatus(c, day, { warnDays, leaveDate })
  return {
    id: c.id, userId: c.userId, kind: c.kind, kindLabel: KINDS[c.kind] || c.kind, title: c.title, number: c.number,
    term: c.term, termLabel: TERMS[c.term], signedDate: c.signedDate, startDate: c.startDate, endDate: c.endDate, probationEnd: c.probationEnd,
    inProbation: !!(c.probationEnd && c.probationEnd >= day && c.startDate <= day),
    restrictMonths: c.restrictMonths, monthlyComp: c.monthlyComp == null ? null : Number(c.monthlyComp),
    restrictWindow: restrictWindow(c, leaveDate),
    serviceMonths: c.serviceMonths, penalty: c.penalty == null ? null : Number(c.penalty),
    hasFile: !!c.fileKey, fileKey: c.fileKey, fileName: c.fileName, fileSize: c.fileSize, renewOfId: c.renewOfId,
    terminatedAt: c.terminatedAt, terminateReason: c.terminateReason, note: c.note,
    status, statusLabel: STATUS[status], daysLeft: daysLeft(c, day),
    employee: emp ? employeeBrief(emp) : null, updatedAt: c.updatedAt
  }
}

/** 一批人的合同（没删的），Map(userId → [合同]) */
export async function contractsOf(userIds) {
  const rows = await prisma.contract.findMany({ where: { deletedAt: null, ...(userIds ? { userId: { in: userIds } } : {}) }, orderBy: [{ startDate: 'desc' }, { id: 'desc' }] })
  const m = new Map()
  for (const c of rows) m.set(c.userId, [...(m.get(c.userId) || []), c])
  return m
}

/**
 * 合同列表。status：EXPIRING（到期提醒内）/ EXPIRED / ACTIVE / IN_FORCE …；missing=LABOR 列出没有有效劳动合同的在职员工
 */
export async function listContracts(ctx, { userId, kind, status, keyword, missing } = {}) {
  const scope = await contractScope(ctx)
  const s = await getSettings()
  const day = await today()
  const empWhere = { ...(scope.all ? {} : { id: { in: [...scope.ids] } }), ...(userId ? { id: Number(userId) } : {}) }
  if (userId && !inScope(scope, userId)) throw forbidden('只能看自己和下属的合同')
  let emps = await prisma.employee.findMany({ where: empWhere })
  const k = String(keyword || '').trim()
  if (k) emps = emps.filter(e => e.name.includes(k) || e.jobNumber?.includes(k) || e.deptPath?.includes(k))
  const byId = new Map(emps.map(e => [e.id, e]))
  if (missing === 'LABOR') {
    const all = await contractsOf([...byId.keys()])
    return {
      missing: emps.filter(e => e.active && !(all.get(e.id) || []).some(c => c.kind === 'LABOR' && ['ACTIVE', 'EXPIRING', 'PENDING'].includes(contractStatus(c, day, { warnDays: s.contractWarnDays }))))
        .map(employeeBrief)
    }
  }
  const rows = await prisma.contract.findMany({
    where: { deletedAt: null, userId: { in: [...byId.keys()] }, ...(kind && KINDS[kind] ? { kind } : {}) },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }]
  })
  let list = rows.map(c => contractDto(c, { emp: byId.get(c.userId), day, warnDays: s.contractWarnDays }))
  if (status) list = list.filter(c => c.status === status)
  // 续签过的旧合同不再算「即将到期」
  const renewed = new Set(rows.filter(c => c.renewOfId).map(c => c.renewOfId))
  for (const c of list) if (renewed.has(c.id)) c.renewed = true
  if (status === 'EXPIRING') list = list.filter(c => !c.renewed)
  const counts = {}
  for (const c of rows.map(c => contractDto(c, { emp: byId.get(c.userId), day, warnDays: s.contractWarnDays }))) {
    if (renewed.has(c.id) && c.status === 'EXPIRING') continue
    counts[c.status] = (counts[c.status] || 0) + 1
  }
  return { rows: list, counts, warnDays: s.contractWarnDays, canEdit: scope.all, storage: await storageEnabled() }
}

export async function getContract(ctx, id) {
  const c = await prisma.contract.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!c) throw notFound('没有这份合同')
  if (!inScope(await contractScope(ctx), c.userId)) throw forbidden('只能看自己和下属的合同')
  const s = await getSettings()
  return contractDto(c, { emp: await prisma.employee.findUnique({ where: { id: c.userId } }), day: await today(), warnDays: s.contractWarnDays })
}

function pick(body) {
  const d = {}
  for (const k of FIELDS) if (body[k] !== undefined) d[k] = body[k] === '' ? null : body[k]
  for (const k of ['restrictMonths', 'serviceMonths']) if (d[k] != null) d[k] = Math.round(Number(d[k]))
  for (const k of ['monthlyComp', 'penalty']) if (d[k] != null) d[k] = Number(d[k])
  for (const k of ['title', 'number']) if (d[k]) d[k] = String(d[k]).slice(0, k === 'title' ? 100 : 50)
  if (d.note) d.note = String(d.note).slice(0, 1000)
  return d
}

/** 文件 key 只能是这个人目录下的（防止把别的文件挂过来） */
function checkFileKey(userId, key) {
  if (key == null) return
  if (typeof key !== 'string' || !key.startsWith(`contracts/${userId}/`) || key.includes('..')) throw badRequest('合同文件不对，重新上传')
}

/** 新建或修改（body.id 有值是改）。返回 { contract, warnings } */
export async function saveContract(ctx, body = {}) {
  await requireHr(ctx)
  const id = body.id ? Number(body.id) : null
  const cur = id ? await prisma.contract.findFirst({ where: { id, deletedAt: null } }) : null
  if (id && !cur) throw notFound('没有这份合同')
  const userId = cur ? cur.userId : Number(body.userId)
  const emp = await prisma.employee.findUnique({ where: { id: userId } })
  if (!emp) throw badRequest('选一个员工')
  const data = pick(body)
  const merged = { ...(cur || {}), ...data, term: data.term || cur?.term || 'FIXED' }
  if (merged.kind === 'NON_COMPETE') { merged.term = 'OPEN'; merged.endDate = null; data.term = 'OPEN'; data.endDate = null }
  const { errors, warnings } = checkContract(merged)
  if (errors.length) throw badRequest(errors.join('；'))
  if (body.fileKey !== undefined) {
    checkFileKey(userId, body.fileKey || null)
    Object.assign(data, { fileKey: body.fileKey || null, fileName: body.fileKey ? String(body.fileName || '').slice(0, 200) || null : null, fileSize: body.fileKey ? Number(body.fileSize) || null : null })
  }
  if (!cur && body.renewOfId) {
    const prev = await prisma.contract.findFirst({ where: { id: Number(body.renewOfId), userId, deletedAt: null } })
    if (!prev) throw badRequest('要续签的合同不存在')
    data.renewOfId = prev.id
  }
  const c = cur
    ? await prisma.contract.update({ where: { id }, data })
    : await prisma.contract.create({ data: { ...data, term: merged.term, userId, createdBy: ctx.user.id } })
  audit(ctx, cur ? 'contract.update' : data.renewOfId ? 'contract.renew' : 'contract.create', { entityType: 'contract', entityId: c.id, detail: { userId, kind: c.kind, startDate: c.startDate, endDate: c.endDate } })
  return { contract: await getContract(ctx, c.id), warnings }
}

/** 提前解除 / 终止 */
export async function terminateContract(ctx, id, { date, reason } = {}) {
  await requireHr(ctx)
  const c = await prisma.contract.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!c) throw notFound('没有这份合同')
  const day = date || await today()
  const { errors } = checkContract({ ...c, terminatedAt: day })
  if (errors.length) throw badRequest(errors.join('；'))
  await prisma.contract.update({ where: { id: c.id }, data: { terminatedAt: day, terminateReason: reason ? String(reason).slice(0, 300) : null } })
  audit(ctx, 'contract.terminate', { entityType: 'contract', entityId: c.id, detail: { userId: c.userId, kind: c.kind, date: day } })
  return getContract(ctx, c.id)
}

export async function removeContract(ctx, id) {
  await requireHr(ctx)
  const c = await prisma.contract.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!c) throw notFound('没有这份合同')
  await prisma.contract.update({ where: { id: c.id }, data: { deletedAt: new Date() } })
  audit(ctx, 'contract.remove', { entityType: 'contract', entityId: c.id, detail: { userId: c.userId, kind: c.kind } })
  return { ok: true }
}

let storageCache = null
async function storageEnabled() {
  if (!ws.enabled) return false
  if (storageCache && storageCache.until > Date.now()) return storageCache.value
  const value = await ws.storage.info().then(i => !!i.enabled).catch(() => false)
  storageCache = { value, until: Date.now() + 60_000 }
  return value
}

/** 合同文件的上传凭证：浏览器拿去直接传七牛（表单：token、key=fullKey、file） */
export async function uploadToken(ctx, { userId, fileName, size } = {}) {
  await requireHr(ctx)
  if (!(await prisma.employee.findUnique({ where: { id: Number(userId) } }))) throw badRequest('选一个员工')
  if (!(await storageEnabled())) throw badRequest('平台没有启用文件存储：请平台管理员在以虎 One「管理 → 系统设置 → 文件存储」里配置')
  if (Number(size) > FILE_MAX_MB * 1024 * 1024) throw badRequest(`文件太大（最大 ${FILE_MAX_MB} MB）`)
  const safe = String(fileName || 'contract').replace(/[\\/\u0000-\u001f]/g, '_').slice(-120)
  const key = `contracts/${Number(userId)}/${crypto.randomBytes(8).toString('hex')}-${safe}`
  const t = await ws.storage.uploadToken({ key, maxSizeMB: FILE_MAX_MB, overwrite: false, expires: 1800 })
  return { uploadUrl: t.uploadUrl, token: t.token, key: t.key, fullKey: t.fullKey }
}

/** 下载合同文件：检查权限后给 5 分钟有效的地址 */
export async function fileUrl(ctx, id) {
  const c = await prisma.contract.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!c?.fileKey) throw notFound('这份合同没有上传文件')
  if (!inScope(await contractScope(ctx), c.userId)) throw forbidden('只能看自己和下属的合同')
  audit(ctx, 'contract.download', { entityType: 'contract', entityId: c.id, detail: { userId: c.userId } })
  return ws.storage.url(c.fileKey, { expires: 300, filename: c.fileName || undefined })
}

/** 即将到期、没续签的劳动合同（简报、AI 助手用） */
export async function expiringContracts(ctx, { withinDays } = {}) {
  const r = await listContracts(ctx, { status: 'EXPIRING' })
  const s = await getSettings()
  const days = Number(withinDays) || s.contractWarnDays
  return r.rows.filter(c => c.kind === 'LABOR' && c.daysLeft != null && c.daysLeft <= days)
}

