// 请假 / 出差 / 外出（从钉钉、飞书、企业微信同步来的「假勤」记录）落到每一天占多少。纯函数，单元测试覆盖。
//   - 各家报了时长（天 / 小时）的，按每天和上班时段的重叠比例把时长分到各个工作日，每天最多 1
//   - 没报时长的，按重叠比例算，取到半天
//   - 只有一天、没有起止时刻的（企业微信按天给），直接用报的天数
// 请假只算工作日；出差、外出每天都标出来（日历上看得到），但只有工作日计入天数
import { eachDay, zonedTime } from './dates.js'

const round2 = (n) => Math.round(n * 100) / 100
const toHalf = (n) => Math.round(n * 2) / 2

/** 这条记录报的时长折成天：days 优先，其次 hours / hoursPerDay；都没有返回 null */
export function reportedDays(a, hoursPerDay = 8) {
  if (a.days != null && Number(a.days) > 0) return Number(a.days)
  if (a.hours != null && Number(a.hours) > 0) return Number(a.hours) / hoursPerDay
  return null
}

/**
 * 每天占多少：[{ date, units, workday }]，units 是天（0 ~ 1，两位小数）
 * opts: { tz, isWork(date), workStart 'HH:mm', workEnd 'HH:mm', hoursPerDay }
 */
export function absenceUnits(a, { tz, isWork, workStart = '09:00', workEnd = '18:00', hoursPerDay = 8 }) {
  const days = eachDay(a.startDate, a.endDate)
  const reported = reportedDays(a, hoursPerDay)
  const counts = (d) => isWork(d)
  // 没有起止时刻：报的天数平均分到工作日（没报就每个工作日一整天）
  if (!a.startAt || !a.endAt) {
    const work = days.filter(counts).length
    const per = reported != null ? Math.min(1, reported / Math.max(1, work)) : 1
    return days.map(d => ({ date: d, workday: isWork(d), units: counts(d) ? round2(per) : 0 }))
  }
  const start = new Date(a.startAt).getTime()
  const end = new Date(a.endAt).getTime()
  const frac = days.map(d => {
    const ws = zonedTime(d, workStart, tz).getTime()
    const we = zonedTime(d, workEnd, tz).getTime()
    const overlap = Math.max(0, Math.min(end, we) - Math.max(start, ws))
    return we > ws ? overlap / (we - ws) : 0
  })
  const workIdx = days.map((d, i) => (counts(d) ? i : -1)).filter(i => i >= 0)
  let units = days.map(() => 0)
  if (reported != null) {
    // 按重叠比例分报的时长；都不重叠（如夜里的时段）就平均分到工作日
    const weight = workIdx.reduce((s, i) => s + frac[i], 0)
    for (const i of workIdx) units[i] = weight > 0 ? (reported * frac[i]) / weight : reported / workIdx.length
    units = units.map(u => round2(Math.min(1, u)))
  } else {
    for (const i of workIdx) units[i] = frac[i] > 0 ? Math.max(0.5, toHalf(frac[i])) : 0
  }
  return days.map((d, i) => ({ date: d, workday: isWork(d), units: units[i] }))
}

/** 各家的假期名称对上本应用的假期类型（按名称；年休假 = 年假，调休假 = 调休）。对不上返回 null */
export function matchType(name, types) {
  const n = String(name || '').trim()
  if (!n) return null
  const alias = { 年休假: '年假', 带薪年假: '年假', 带薪年休假: '年假', 调休假: '调休', 倒休: '调休', 产检假: '产假', 护理假: '陪产假' }
  const want = alias[n] || n
  const hit = types.find(t => t.name === want) || types.find(t => t.name === n.replace(/假$/, '') + '假')
  return hit?.code || null
}

export const CATEGORY_LABEL = { LEAVE: '请假', TRIP: '出差', OUT: '外出' }
