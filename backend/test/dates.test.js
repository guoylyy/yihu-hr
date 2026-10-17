import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkDays, dayInTz, halfSlots, isDateStr, isWorkday, leaveUnits, monthRange, sumUnits, unitsByYear, zonedTime } from '../src/lib/dates.js'

const holidays = new Map([['2026-10-01', 'HOLIDAY'], ['2026-10-02', 'HOLIDAY'], ['2026-10-10', 'WORKDAY']])
const work = (d) => isWorkday(d, holidays)

test('isDateStr 拒绝不存在的日期', () => {
  assert.ok(isDateStr('2028-02-29'))
  assert.ok(!isDateStr('2026-02-29'))
  assert.ok(!isDateStr('2026-1-1'))
})

test('工作日：调休上班优先，其次节假日，最后看星期', () => {
  assert.equal(work('2026-10-01'), false) // 周四，国庆
  assert.equal(work('2026-10-10'), true) // 周六，调休上班
  assert.equal(work('2026-10-11'), false) // 周日
  assert.equal(work('2026-10-12'), true)
})

test('请假天数：半天、跨周末、节假日不算', () => {
  // 周五下午到下周一上午 = 1 天
  assert.equal(sumUnits(leaveUnits({ startDate: '2026-10-16', startHalf: 'PM', endDate: '2026-10-19', endHalf: 'AM' }, work)), 1)
  // 同一天上午 = 0.5
  assert.equal(sumUnits(leaveUnits({ startDate: '2026-10-12', startHalf: 'AM', endDate: '2026-10-12', endHalf: 'AM' }, work)), 0.5)
  // 同一天下午开始上午结束 = 0
  assert.equal(sumUnits(leaveUnits({ startDate: '2026-10-12', startHalf: 'PM', endDate: '2026-10-12', endHalf: 'AM' }, work)), 0)
  // 9/30 ~ 10/10：9/30、10/5~10/9、10/10（调休）= 7 天
  assert.equal(sumUnits(leaveUnits({ startDate: '2026-09-30', endDate: '2026-10-10' }, work)), 7)
})

test('半天占位用来判断重叠', () => {
  const a = halfSlots({ startDate: '2026-10-12', startHalf: 'AM', endDate: '2026-10-12', endHalf: 'AM' }, work)
  const b = halfSlots({ startDate: '2026-10-12', startHalf: 'PM', endDate: '2026-10-13', endHalf: 'PM' }, work)
  assert.ok(![...a].some(x => b.has(x)))
  assert.deepEqual([...b], ['2026-10-12:PM', '2026-10-13:AM', '2026-10-13:PM'])
})

test('跨年的假按年份拆开', () => {
  const u = leaveUnits({ startDate: '2026-12-30', endDate: '2027-01-05' }, (d) => isWorkday(d, new Map()))
  assert.deepEqual(unitsByYear(u), { 2026: 2, 2027: 3 })
})

test('时区换算', () => {
  const t = zonedTime('2026-10-16', '09:00', 'Asia/Shanghai')
  assert.equal(t.toISOString(), '2026-10-16T01:00:00.000Z')
  assert.equal(dayInTz(new Date('2026-10-15T17:30:00Z'), 'Asia/Shanghai'), '2026-10-16')
  // 有夏令时的时区
  assert.equal(zonedTime('2026-07-01', '09:00', 'Europe/Berlin').toISOString(), '2026-07-01T07:00:00.000Z')
  assert.equal(zonedTime('2026-12-01', '09:00', 'Europe/Berlin').toISOString(), '2026-12-01T08:00:00.000Z')
})

test('按天数切段、月份范围', () => {
  assert.deepEqual(chunkDays('2026-10-01', '2026-10-16', 7), [['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-10-16']])
  assert.deepEqual(monthRange('2028-02'), ['2028-02-01', '2028-02-29'])
  assert.equal(monthRange('2026-13'), null)
})
