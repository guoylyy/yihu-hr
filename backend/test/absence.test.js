import test from 'node:test'
import assert from 'node:assert/strict'
import { absenceUnits, matchType, reportedDays } from '../src/lib/absence.js'
import { dayStatus, summarize } from '../src/lib/dayStatus.js'

const TZ = 'Asia/Shanghai'
// 2026-10-17 / 18 是周末
const isWork = (d) => !['2026-10-17', '2026-10-18'].includes(d)
const opts = { tz: TZ, isWork, workStart: '09:00', workEnd: '18:00', hoursPerDay: 8 }
const at = (s) => new Date(`${s}+08:00`)
const map = (list) => Object.fromEntries(list.map(u => [u.date, u.units]))

test('报了天数：按和上班时段的重叠分到工作日，周末不算', () => {
  const a = { startDate: '2026-10-15', endDate: '2026-10-19', startAt: at('2026-10-15T09:00:00'), endAt: at('2026-10-19T18:00:00'), days: 3 }
  assert.deepEqual(map(absenceUnits(a, opts)), { '2026-10-15': 1, '2026-10-16': 1, '2026-10-17': 0, '2026-10-18': 0, '2026-10-19': 1 })
})

test('半天：上午 9 点到 13:30，报 0.5 天', () => {
  const a = { startDate: '2026-10-15', endDate: '2026-10-15', startAt: at('2026-10-15T09:00:00'), endAt: at('2026-10-15T13:30:00'), days: 0.5 }
  assert.deepEqual(map(absenceUnits(a, opts)), { '2026-10-15': 0.5 })
})

test('按小时：2 小时 = 0.25 天', () => {
  const a = { startDate: '2026-10-15', endDate: '2026-10-15', startAt: at('2026-10-15T14:00:00'), endAt: at('2026-10-15T16:00:00'), hours: 2 }
  assert.equal(reportedDays(a, 8), 0.25)
  assert.deepEqual(map(absenceUnits(a, opts)), { '2026-10-15': 0.25 })
})

test('没报时长：按重叠比例取到半天，至少半天', () => {
  const a = { startDate: '2026-10-15', endDate: '2026-10-16', startAt: at('2026-10-15T14:00:00'), endAt: at('2026-10-16T18:00:00') }
  assert.deepEqual(map(absenceUnits(a, opts)), { '2026-10-15': 0.5, '2026-10-16': 1 })
})

test('企业微信按天给、没有起止时刻：直接用报的天数；周末占 0', () => {
  assert.deepEqual(map(absenceUnits({ startDate: '2026-10-15', endDate: '2026-10-15', days: 0.5 }, opts)), { '2026-10-15': 0.5 })
  assert.deepEqual(map(absenceUnits({ startDate: '2026-10-17', endDate: '2026-10-17', days: 1 }, opts)), { '2026-10-17': 0 })
})

test('假期名称对上本应用的类型', () => {
  const types = [{ code: 'ANNUAL', name: '年假' }, { code: 'COMP', name: '调休' }, { code: 'SICK', name: '病假' }]
  assert.equal(matchType('年假', types), 'ANNUAL')
  assert.equal(matchType('年休假', types), 'ANNUAL')
  assert.equal(matchType('调休假', types), 'COMP')
  assert.equal(matchType('病假', types), 'SICK')
  assert.equal(matchType('育儿假', types), null)
  assert.equal(matchType(null, types), null)
})

const p = (kind, result, hh) => ({ kind, result, source: 'FEISHU', checkTime: hh ? new Date(`2026-10-15T${hh}:00+08:00`) : null })

test('出差一整天：TRIP，缺卡不算', () => {
  const s = dayStatus({ punches: [p('IN', 'MISSING')], away: [{ category: 'TRIP', name: '出差', units: 1 }] })
  assert.equal(s.status, 'TRIP')
  assert.deepEqual(s.flags, [])
})

test('外出半天：时间类异常不算；没有打卡记录时是 OUT', () => {
  assert.equal(dayStatus({ punches: [p('IN', 'LATE', '11:00')], away: [{ category: 'OUT', units: 0.5 }] }).status, 'NORMAL')
  assert.equal(dayStatus({ away: [{ category: 'OUT', units: 0.25 }] }).status, 'OUT')
})

test('请假按 leaveTypes 加起来；半天假 + 半天出差也算满一天', () => {
  assert.equal(dayStatus({ leaveTypes: [{ name: '年假', units: 0.5 }, { name: '事假', units: 0.5 }] }).status, 'LEAVE')
  assert.equal(dayStatus({ leaveTypes: [{ name: '年假', units: 0.5 }], away: [{ category: 'TRIP', units: 0.5 }] }).flags.length, 0)
})

test('月度汇总：请假按名称、出差天数、外出天数', () => {
  const days = [
    { date: '2026-10-15', ...dayStatus({ leaveTypes: [{ code: 'ANNUAL', name: '年假', units: 1 }] }) },
    { date: '2026-10-16', ...dayStatus({ away: [{ category: 'TRIP', units: 1 }] }) },
    { date: '2026-10-17', ...dayStatus({ workday: false, away: [{ category: 'TRIP', units: 0 }] }) },
    { date: '2026-10-19', ...dayStatus({ punches: [p('IN', 'NORMAL', '09:00')], away: [{ category: 'OUT', units: 0.25 }] }) }
  ]
  const s = summarize(days)
  assert.deepEqual(s.leaveByType, { 年假: 1 })
  assert.equal(s.leaveDays, 1)
  assert.equal(s.tripDays, 1)
  assert.equal(s.outDays, 1)
  assert.equal(s.normal, 1)
})

test('还没到的日子：没记录是 FUTURE，不算进出勤率的分母；提前请好的假照样显示', () => {
  const days = [
    { date: '2026-10-15', ...dayStatus({ punches: [p('IN', 'NORMAL', '09:00')] }) },
    { date: '2026-10-16', ...dayStatus({ future: true }) },
    { date: '2026-10-19', ...dayStatus({ future: true, leaveTypes: [{ name: '年假', units: 0.5 }] }) }
  ]
  assert.deepEqual(days.map(d => d.status), ['NORMAL', 'FUTURE', 'LEAVE'])
  const s = summarize(days)
  assert.equal(s.workdays, 3)
  assert.equal(s.due, 1)
  assert.equal(s.noData, 0)
})
