// 打卡同步：定时把三家的打卡结果拉过来，按 (来源, 外部 id) 去重存进 Punch；
// 再把已通过的请假 / 出差 / 外出拉过来存进 Absence（往后多拉 absenceAheadDays 天，提前请的假也看得到）
//   - 人对人：平台用户主数据里的 dingUserId / feishuOpenId / wecomUserId（对不上的人数记在同步记录里）
//   - 每次重拉最近 syncLookbackDays 天（补卡、改结果、撤销请假会改动前几天）；首次同步拉 31 天
//   - 假勤拉失败不影响打卡：打卡照样算成功，假勤这一步的结果单独记（absenceOk / absenceError），设置页单独显示
//   - 假勤第一次成功之前（刚升级、刚配好权限）往前补拉 ABSENCE_BACKFILL_DAYS 天，之后和打卡一样重拉最近几天
//   - 同一来源同时只跑一个；一家出错不影响别家
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { addDays, chunk, chunkDays, dayInTz, diffDays, isDateStr } from '../lib/dates.js'
import { PROVIDERS, providerOf } from '../providers/index.js'
import { getSettings } from './settings.js'
import { requireHr } from './access.js'
import { audit } from './audit.js'
import { syncDirectory } from './directory.js'
import { cancelMissing, saveAbsences } from './absences.js'
import { platformError, refreshPlatformChannels } from '../providers/platformToken.js'
const PLATFORM_KEY = { DINGTALK: 'dingtalk', FEISHU: 'feishu' }

const running = new Set()
const ABSENCE_BACKFILL_DAYS = 90

/** 飞书：把还没换过的 open_id 换成 user_id（没权限就跳过，按工号兜底） */
async function resolveFeishu(p, emps) {
  const todo = emps.filter(e => e.feishuOpenId && !e.feishuUserId)
  for (const part of chunk(todo, 50)) {
    try {
      const m = await p.resolveUserIds(part.map(e => e.feishuOpenId))
      for (const e of part) {
        const uid = m.get(e.feishuOpenId)
        if (!uid) continue
        e.feishuUserId = uid
        await prisma.employee.update({ where: { id: e.id }, data: { feishuUserId: uid } })
      }
    } catch (err) {
      console.warn(`[hr] 飞书 open_id 换 user_id 失败（按工号兜底）：${err.message}`)
      return
    }
  }
}

async function savePunches(list) {
  let saved = 0
  for (const p of list) {
    const { vendorUserId, ...data } = p
    await prisma.punch.upsert({
      where: { source_externalId: { source: data.source, externalId: data.externalId } },
      create: data,
      update: { workDate: data.workDate, kind: data.kind, checkTime: data.checkTime, planTime: data.planTime, result: data.result, location: data.location, note: data.note, raw: data.raw, userId: data.userId }
    })
    saved++
  }
  return saved
}

/**
 * 一家的请假 / 出差 / 外出：按批拉完一批人就对一次账（这段时间里各家已经没有的标撤销）。
 * 要逐条补查的（钉钉）：线索来自已经存下的打卡记录，查过的记在 SyncSeen，下次不再查
 */
async function syncAbsences(p, idMap, from, to, tz) {
  let pending = 0
  const all = new Set()
  let hints = []
  const set = new Set()
  const known = (k) => set.has(k)
  if (p.approvalHint) {
    const back = new Map([...idMap].map(([vid, uid]) => [uid, vid]))
    const punches = await prisma.punch.findMany({ where: { source: p.source, workDate: { gte: from, lte: to } }, select: { userId: true, workDate: true, raw: true } })
    hints = punches.map(x => p.approvalHint({ ...x, vendorUserId: back.get(x.userId) })).filter(h => h?.userid)
    const [seenRows, typed] = await Promise.all([
      prisma.syncSeen.findMany({ where: { source: p.source }, select: { key: true } }),
      prisma.absence.findMany({ where: { source: p.source, typeName: { not: null }, endDate: { gte: from } }, select: { externalId: true } })
    ])
    for (const k of [...seenRows.map(r => r.key), ...typed.map(r => r.externalId)]) set.add(k)
  }
  for (const ids of chunk([...idMap.keys()], p.absenceBatchUsers || p.batchUsers)) {
    const seen = []
    for (const [a, b] of chunkDays(from, to, p.absenceMaxDays || p.maxDays)) {
      const raw = await p.fetchAbsences(ids, a, b, tz, { hints, known })
      if (raw.checked?.length) {
        await prisma.syncSeen.createMany({ data: raw.checked.map(key => ({ source: p.source, key })), skipDuplicates: true })
        for (const k of raw.checked) set.add(k)
      }
      pending += raw.pending || 0
      const list = raw.map(x => ({ ...x, userId: idMap.get(x.vendorUserId) })).filter(x => x.userId)
      await saveAbsences(list)
      seen.push(...list.map(x => x.externalId))
    }
    await cancelMissing(p.source, ids.map(id => idMap.get(id)), from, to, [...new Set(seen)])
    for (const k of seen) all.add(k)
  }
  return { saved: all.size, pending }
}

/** 同步一家。from/to 不给就按设置重拉最近几天 */
export async function syncSource(source, { from, to, trigger = 'AUTO' } = {}) {
  const p = providerOf(source)
  if (!p) throw badRequest(`没有打卡来源 ${source}`)
  if (!p.configured()) return { skipped: `${p.label}未配置` }
  if (running.has(source)) return { skipped: `${p.label}正在同步` }
  running.add(source)
  try {
    return await runSource(p, { from, to, trigger })
  } finally {
    running.delete(source)
  }
}

async function runSource(p, { from, to, trigger }) {
  const source = p.source
  const s = await getSettings()
  const today = dayInTz(new Date(), s.timezone)
  const explicit = !!from
  if (!from) {
    const done = await prisma.syncRun.count({ where: { source, ok: true } })
    from = addDays(today, -(done ? s.syncLookbackDays - 1 : 30))
  }
  to = to || today
  const run = await prisma.syncRun.create({ data: { source, trigger, dateFrom: from, dateTo: to } })
  try {
    const emps = await prisma.employee.findMany({ where: { active: true } })
    if (source === 'FEISHU') await resolveFeishu(p, emps)
    const idMap = new Map()
    let unmatched = 0
    for (const e of emps) {
      const id = p.idOf(e)
      if (id) idMap.set(id, e.id)
      else unmatched++
    }
    let fetched = 0, saved = 0
    for (const ids of chunk([...idMap.keys()], p.batchUsers)) {
      for (const [a, b] of chunkDays(from, to, p.maxDays)) {
        const list = (await p.fetch(ids, a, b, s.timezone))
          .map(x => ({ ...x, userId: idMap.get(x.vendorUserId) }))
          .filter(x => x.userId)
        fetched += list.length
        saved += await savePunches(list)
      }
    }
    let absences = 0, absenceError = null, absenceOk = null, aFrom = null, aTo = null, pending = 0
    if (p.fetchAbsences) {
      // 假勤还没成功过（刚升级、刚开好权限）：往前补拉，历史请假也能看到；手动指定了日期的按指定的
      const okBefore = explicit ? 1 : await prisma.syncRun.count({ where: { source, absenceOk: true } })
      aFrom = okBefore ? from : addDays(today, -ABSENCE_BACKFILL_DAYS)
      aTo = addDays(to, s.absenceAheadDays)
      try {
        const r = await syncAbsences(p, idMap, aFrom, aTo, s.timezone)
        absences = r.saved
        pending = r.pending
        absenceOk = true
      } catch (e) {
        absenceOk = false
        absenceError = e.message
        console.warn(`[hr] ${p.label}请假 / 出差 / 外出没有同步：${e.message}`)
      }
    }
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { ok: true, fetched, saved, unmatched, absences, absenceOk, absenceFrom: aFrom, absenceTo: aTo, absenceError: absenceError || (pending ? `还有 ${pending} 天的审批详情没查（每次限量，下次接着查）` : null), finishedAt: new Date() }
    })
    return { source, from, to, fetched, saved, unmatched, absences, absenceOk, ...(absenceError ? { warning: `请假 / 出差 / 外出没有同步：${absenceError}` } : {}) }
  } catch (e) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: false, error: String(e.message).slice(0, 2000), finishedAt: new Date() } })
    throw e
  }
}

/** 所有配了的来源都同步一遍，出错的记下来不抛 */
export async function syncAll(opts = {}) {
  const out = []
  for (const p of PROVIDERS.filter(x => x.configured())) {
    try { out.push(await syncSource(p.source, opts)) } catch (e) { out.push({ source: p.source, error: e.message }) }
  }
  return out
}

/** 人事手动同步（可指定日期范围补历史，一次最多 62 天） */
export async function manualSync(ctx, { source, from, to } = {}) {
  await requireHr(ctx)
  if ((from && !isDateStr(from)) || (to && !isDateStr(to))) throw badRequest('日期格式是 YYYY-MM-DD')
  if (from && to && (from > to || diffDays(from, to) > 61)) throw badRequest('一次最多同步 62 天')
  if (source === 'DIRECTORY') {
    const r = await syncDirectory({ full: true, trigger: 'MANUAL' })
    audit(ctx, 'sync.directory', { detail: r })
    return [r]
  }
  const out = source ? [await syncSource(source, { from, to, trigger: 'MANUAL' })] : await syncAll({ from, to, trigger: 'MANUAL' })
  audit(ctx, 'sync.run', { entityType: 'sync', detail: { source: source || 'ALL', from, to } })
  return out
}

/** 设置页：每个来源配没配、最近一次结果、对不上的人 */
export async function syncStatus(ctx) {
  await requireHr(ctx)
  await refreshPlatformChannels() // 刚在平台配好登录方式的，这里立刻能看到
  const emps = await prisma.employee.findMany({ where: { active: true } })
  const sources = []
  for (const p of [...PROVIDERS, { source: 'DIRECTORY', label: '平台通讯录', configured: () => true }]) {
    const runs = await prisma.syncRun.findMany({ where: { source: p.source }, orderBy: { id: 'desc' }, take: 10 })
    // 请假 / 出差 / 外出这一步：最近一次结果、最近一次成功、已经存了多少
    let absence = null
    if (p.fetchAbsences) {
      const [last, lastOk, counts] = await Promise.all([
        prisma.syncRun.findFirst({ where: { source: p.source, absenceOk: { not: null } }, orderBy: { id: 'desc' } }),
        prisma.syncRun.findFirst({ where: { source: p.source, absenceOk: true }, orderBy: { id: 'desc' } }),
        prisma.absence.groupBy({ by: ['category'], where: { source: p.source, status: 'APPROVED' }, _count: true })
      ])
      absence = {
        covers: p.absenceCovers, hint: p.absenceHint,
        last: last && { ok: last.absenceOk, at: last.finishedAt || last.startedAt, from: last.absenceFrom, to: last.absenceTo, saved: last.absences, error: last.absenceError },
        lastOkAt: lastOk?.finishedAt || null,
        counts: Object.fromEntries(counts.map(c => [c.category, c._count]))
      }
    }
    const unmatchedPeople = p.idOf
      ? emps.filter(e => !p.idOf(e)).slice(0, 200).map(e => ({ id: e.id, name: e.name, deptPath: e.deptPath, jobNumber: e.jobNumber }))
      : []
    sources.push({
      source: p.source, label: p.label, configured: p.configured(), credSource: p.credSource?.() || null,
      setupHint: p.setupHint || null, hint: p.hint || null, platformError: PLATFORM_KEY[p.source] ? platformError(PLATFORM_KEY[p.source]) : null,
      running: running.has(p.source), runs, unmatchedPeople, absence
    })
  }
  return { employees: emps.length, sources }
}

let timer = null
let lastDirFull = 0
/** 后台定时：每分钟看一次到没到间隔 */
export function startScheduler() {
  let lastRun = 0
  let lastDir = 0
  let lastChannels = 0
  const tick = async () => {
    try {
      const s = await getSettings()
      const now = Date.now()
      if (now - lastChannels > 600_000) { lastChannels = now; await refreshPlatformChannels() }
      if (now - lastDir > 3600_000) {
        lastDir = now
        const full = now - lastDirFull > 24 * 3600_000
        if (full) lastDirFull = now
        await syncDirectory({ full }).catch(e => console.warn(`[hr] 通讯录同步失败：${e.message}`))
      }
      if (s.syncEnabled && now - lastRun > s.syncIntervalMinutes * 60_000) {
        lastRun = now
        for (const r of await syncAll()) if (r.error) console.warn(`[hr] ${r.source} 同步失败：${r.error}`)
      }
    } catch (e) {
      console.warn(`[hr] 定时同步出错：${e.message}`)
    }
  }
  timer = setInterval(tick, 60_000)
  timer.unref()
  setTimeout(tick, 5_000).unref()
}
