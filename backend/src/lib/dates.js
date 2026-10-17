// 日期都用 'YYYY-MM-DD' 字符串表示「考勤日」，按 UTC 解析做加减，和服务器时区无关；
// 真正的时刻（打卡时间）用 Date，换成考勤日时才看时区。纯函数，单元测试覆盖。

const DAY = 86400_000
const RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateStr(s) {
  if (typeof s !== 'string' || !RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function parseDay(s) { return new Date(s + 'T00:00:00Z') }
export function fmtDay(d) { return d.toISOString().slice(0, 10) }
export function addDays(s, n) { return fmtDay(new Date(parseDay(s).getTime() + n * DAY)) }
export function diffDays(a, b) { return Math.round((parseDay(b) - parseDay(a)) / DAY) }
/** 0 = 周日 … 6 = 周六 */
export function weekday(s) { return parseDay(s).getUTCDay() }

/** [from, to] 闭区间的每一天 */
export function eachDay(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** 把 [from, to] 切成不超过 size 天的段（三家接口都限制一次查的天数） */
export function chunkDays(from, to, size) {
  const out = []
  for (let s = from; s <= to; s = addDays(s, size)) {
    const e = addDays(s, size - 1)
    out.push([s, e < to ? e : to])
  }
  return out
}

export function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 某个时刻在 tz 时区是哪一天 */
export function dayInTz(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** 某个时刻在 tz 时区的 HH:mm */
export function timeInTz(date, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/** tz 时区在某时刻相对 UTC 的偏移（分钟） */
function offsetMinutes(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((asUtc - date.getTime()) / 60000)
}

/** tz 时区的「某天 HH:mm」是哪个时刻 */
export function zonedTime(day, hhmm, tz) {
  if (!isDateStr(day) || !/^\d{2}:\d{2}$/.test(hhmm)) return null
  const naive = new Date(`${day}T${hhmm}:00Z`)
  const first = new Date(naive.getTime() - offsetMinutes(naive, tz) * 60000)
  // 夏令时边界再校一次
  return new Date(naive.getTime() - offsetMinutes(first, tz) * 60000)
}

export function currentYear(tz) { return Number(dayInTz(new Date(), tz).slice(0, 4)) }

/**
 * 是否工作日。holidays: Map(date -> 'HOLIDAY' | 'WORKDAY')；workweek: 上班的星期几，如 [1,2,3,4,5]
 * 调休上班日（WORKDAY）优先，其次法定假日（HOLIDAY），最后看星期
 */
export function isWorkday(day, holidays, workweek = [1, 2, 3, 4, 5]) {
  const k = holidays?.get(day)
  if (k === 'WORKDAY') return true
  if (k === 'HOLIDAY') return false
  return workweek.includes(weekday(day))
}

/**
 * 请假占用的工作日：返回 [{ date, units }]，units 为 0.5 或 1，只含工作日
 * startHalf: AM 从上午开始 / PM 从下午开始；endHalf: AM 上午结束 / PM 下午结束
 */
export function leaveUnits({ startDate, startHalf = 'AM', endDate, endHalf = 'PM' }, workdayFn) {
  const out = []
  for (const d of eachDay(startDate, endDate)) {
    if (!workdayFn(d)) continue
    let u = 1
    if (d === startDate && startHalf === 'PM') u -= 0.5
    if (d === endDate && endHalf === 'AM') u -= 0.5
    if (startDate === endDate && startHalf === 'PM' && endHalf === 'AM') u = 0
    if (u > 0) out.push({ date: d, units: u })
  }
  return out
}

export function sumUnits(units) { return units.reduce((s, x) => s + x.units, 0) }

/** 'YYYY-MM' → [第一天, 最后一天] */
export function monthRange(ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '')) return null
  const first = `${ym}-01`
  const [y, m] = ym.split('-').map(Number)
  const last = fmtDay(new Date(Date.UTC(y, m, 0)))
  return [first, last]
}

/** 请假占用的半天：Set('YYYY-MM-DD:AM' | 'YYYY-MM-DD:PM')，只含工作日。判断两次请假是否重叠用 */
export function halfSlots(req, workdayFn) {
  const out = new Set()
  for (const d of eachDay(req.startDate, req.endDate)) {
    if (!workdayFn(d)) continue
    const am = !(d === req.startDate && req.startHalf === 'PM')
    const pm = !(d === req.endDate && req.endHalf === 'AM')
    if (am) out.add(`${d}:AM`)
    if (pm) out.add(`${d}:PM`)
  }
  return out
}

/** 按年份汇总 units：{ 2026: 1.5, 2027: 2 }（跨年的假分别扣两年的余额） */
export function unitsByYear(units) {
  const out = {}
  for (const u of units) {
    const y = Number(u.date.slice(0, 4))
    out[y] = (out[y] || 0) + u.units
  }
  return out
}
