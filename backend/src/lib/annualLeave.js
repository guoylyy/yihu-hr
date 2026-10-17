// 法定年休假天数（《职工带薪年休假条例》《企业职工带薪年休假实施办法》）：
//   累计工作满 1 年不满 10 年 5 天，满 10 年不满 20 年 10 天，满 20 年 15 天；不满 1 年没有
//   新入职、或年中跨过档位的，按当年在本单位的日历天数逐日折算，折算后不足 1 整天的部分不享受
// 公司另给的福利年假（extraDays）按同样的方式折算。纯函数，单元测试覆盖。
import { addDays, eachDay, isDateStr } from './dates.js'

/** from 到 on 满了几整年 */
export function fullYears(from, on) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [oy, om, od] = on.split('-').map(Number)
  let n = oy - fy
  if (om < fm || (om === fm && od < fd)) n--
  return n
}

export function statutoryTier(years) {
  if (years >= 20) return 15
  if (years >= 10) return 10
  if (years >= 1) return 5
  return 0
}

/**
 * 某年应发的年假
 *   workStartDate 参加工作日期（算累计工龄）；hireDate 入职本单位日期（算当年在本单位的天数）
 *   rounding: 'floor' 不足 1 天不给（法定）/ 'half' 精确到半天
 * 返回 { days, segments: [{ from, to, perYear }] }；缺参加工作日期返回 null
 */
export function annualEntitlement({ workStartDate, hireDate, year, extraDays = 0, rounding = 'floor', leaveDate }) {
  if (!isDateStr(workStartDate)) return null
  const jan1 = `${year}-01-01`
  const dec31 = `${year}-12-31`
  const start = hireDate && isDateStr(hireDate) && hireDate > jan1 ? hireDate : jan1
  const end = leaveDate && isDateStr(leaveDate) && leaveDate < dec31 ? leaveDate : dec31
  if (start > dec31 || end < jan1 || start > end) return { days: 0, segments: [] }

  const yearLen = eachDay(jan1, dec31).length
  let total = 0
  const segments = []
  for (const d of eachDay(start, end)) {
    const tier = statutoryTier(fullYears(workStartDate, d))
    const perYear = tier > 0 ? tier + Number(extraDays || 0) : 0
    total += perYear
    const last = segments[segments.length - 1]
    if (last && last.perYear === perYear && addDays(last.to, 1) === d) last.to = d
    else segments.push({ from: d, to: d, perYear })
  }
  const exact = total / yearLen
  const days = rounding === 'half' ? Math.floor(exact * 2 + 1e-9) / 2 : Math.floor(exact + 1e-9)
  return { days, segments: segments.filter(s => s.perYear > 0) }
}
