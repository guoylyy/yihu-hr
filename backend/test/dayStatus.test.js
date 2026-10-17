import test from 'node:test'
import assert from 'node:assert/strict'
import { dayStatus, summarize } from '../src/lib/dayStatus.js'

const p = (kind, result, hh, source = 'DINGTALK') => ({ kind, result, source, checkTime: hh ? new Date(`2026-10-12T${hh}:00+08:00`) : null })

test('正常：取最早上班、最晚下班', () => {
  const s = dayStatus({ punches: [p('IN', 'NORMAL', '08:55'), p('OUT', 'NORMAL', '18:10'), p('OUT', 'NORMAL', '18:30')] })
  assert.equal(s.status, 'NORMAL')
  assert.equal(s.lastOut.toISOString(), '2026-10-12T10:30:00.000Z')
})

test('迟到 + 缺卡 → 异常', () => {
  const s = dayStatus({ punches: [p('IN', 'LATE', '09:20'), p('OUT', 'MISSING')] })
  assert.equal(s.status, 'ABNORMAL')
  assert.deepEqual(s.flags.sort(), ['LATE', 'MISSING'])
})

test('请满一天假：以请假为准，旷工不算', () => {
  assert.equal(dayStatus({ punches: [p('IN', 'ABSENT')], leaveUnits: 1 }).status, 'LEAVE')
})

test('请半天假：时间类异常不算，地点异常照算', () => {
  assert.equal(dayStatus({ punches: [p('IN', 'LATE', '13:20'), p('OUT', 'NORMAL', '18:00')], leaveUnits: 0.5 }).status, 'NORMAL')
  assert.deepEqual(dayStatus({ punches: [p('IN', 'LOCATION', '13:20')], leaveUnits: 0.5 }).flags, ['LOCATION'])
})

test('手工补录覆盖同一类的缺卡', () => {
  const s = dayStatus({ punches: [p('IN', 'NORMAL', '08:50'), p('OUT', 'MISSING'), p('OUT', 'NORMAL', '18:05', 'MANUAL')] })
  assert.equal(s.status, 'NORMAL')
  assert.ok(s.lastOut)
})

test('没有记录：工作日 NO_DATA，休息日 REST', () => {
  assert.equal(dayStatus({ workday: true }).status, 'NO_DATA')
  assert.equal(dayStatus({ workday: false }).status, 'REST')
})

test('月度汇总', () => {
  const days = [
    { ...dayStatus({ punches: [p('IN', 'LATE', '09:20')] }), workday: true },
    { ...dayStatus({ punches: [p('IN', 'NORMAL', '08:50')] }), workday: true },
    { ...dayStatus({ leaveUnits: 1, leaveTypes: [{ code: 'ANNUAL', units: 1 }] }), workday: true },
    { ...dayStatus({ workday: false }), workday: false }
  ]
  const s = summarize(days)
  assert.equal(s.workdays, 3)
  assert.equal(s.late, 1)
  assert.equal(s.normal, 1)
  assert.deepEqual(s.leaveByType, { ANNUAL: 1 })
})
