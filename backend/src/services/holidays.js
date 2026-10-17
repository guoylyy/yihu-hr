// 节假日与调休：每年国务院公布放假安排后，人事在「设置 → 节假日」里录一次
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { isDateStr, isWorkday } from '../lib/dates.js'
import { requireHr } from './access.js'
import { audit } from './audit.js'
import { getSettings } from './settings.js'

/** 工作日判断函数（加载一次节假日表） */
export async function workdayFn() {
  const [rows, s] = await Promise.all([prisma.holiday.findMany(), getSettings()])
  const map = new Map(rows.map(r => [r.date, r.kind]))
  return (d) => isWorkday(d, map, s.workweek)
}

export async function listHolidays(ctx, { year } = {}) {
  const y = Number(year) || new Date().getFullYear()
  return prisma.holiday.findMany({ where: { date: { startsWith: `${y}-` } }, orderBy: { date: 'asc' } })
}

/**
 * 批量录入：text 每行一条「日期 类型 名称」，类型写 休 / 班（或 HOLIDAY / WORKDAY），如
 *   2026-10-01 休 国庆节
 *   2026-10-11 班 国庆调休
 */
export function parseHolidayText(text) {
  const out = []
  const errors = []
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const [date, kindRaw, ...rest] = t.split(/[\s,，\t]+/)
    const kind = { 休: 'HOLIDAY', 假: 'HOLIDAY', HOLIDAY: 'HOLIDAY', 班: 'WORKDAY', WORKDAY: 'WORKDAY' }[String(kindRaw || '').toUpperCase()] ||
      { 休: 'HOLIDAY', 假: 'HOLIDAY', 班: 'WORKDAY' }[kindRaw]
    if (!isDateStr(date) || !kind) errors.push(`第 ${i + 1} 行看不懂：${t}`)
    else out.push({ date, kind, name: rest.join(' ').slice(0, 50) || null })
  })
  return { rows: out, errors }
}

export async function importHolidays(ctx, { text }) {
  await requireHr(ctx)
  const { rows, errors } = parseHolidayText(text)
  if (errors.length) throw badRequest(errors.slice(0, 5).join('；'))
  if (!rows.length) throw badRequest('没有要录入的日期')
  for (const r of rows) await prisma.holiday.upsert({ where: { date: r.date }, create: r, update: { kind: r.kind, name: r.name } })
  audit(ctx, 'holiday.import', { entityType: 'holiday', detail: { count: rows.length, from: rows[0].date, to: rows[rows.length - 1].date } })
  return { saved: rows.length }
}

export async function deleteHoliday(ctx, date) {
  await requireHr(ctx)
  await prisma.holiday.deleteMany({ where: { date } })
  audit(ctx, 'holiday.delete', { entityType: 'holiday', entityId: date })
  return { ok: true }
}
