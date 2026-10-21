import test from 'node:test'
import assert from 'node:assert/strict'
import { attendanceExempt, evaluationExempt, parseExemption } from '../src/lib/exemption.js'
import { flagsFor } from '../src/lib/portrait.js'
import { PROFILE_FIELDS, diffRecord } from '../src/lib/importer.js'

test('豁免的写法', () => {
  assert.equal(parseExemption('董事会成员'), 'FULL')
  assert.equal(parseExemption('不参与考核'), 'FULL')
  assert.equal(parseExemption('免打卡'), 'ATTENDANCE')
  assert.equal(parseExemption('免考勤'), 'ATTENDANCE')
  assert.equal(parseExemption('正常'), 'NONE')
  assert.equal(parseExemption('FULL'), 'FULL')
  assert.equal(parseExemption('看情况'), null)
  assert.equal(attendanceExempt({ exemption: 'FULL' }), true)
  assert.equal(attendanceExempt({ exemption: 'ATTENDANCE' }), true)
  assert.equal(evaluationExempt({ exemption: 'ATTENDANCE' }), false)
  assert.equal(attendanceExempt({}), false)
})

const settings = { contractWarnDays: 60, oneOnOneCadenceDays: 30 }
const base = { employee: { active: true }, contracts: [], last1v1: { date: '2026-01-01', mood: 1 }, openActions: 2, abnormalDays: 5, today: '2026-10-20', settings }
const codes = (x) => flagsFor(x).map(f => f.code).sort()

test('标记：免考勤只去掉考勤异常；不参与考核去掉考核类和董事本来没有的合同', () => {
  assert.deepEqual(codes(base), ['ATTENDANCE', 'LOW_MOOD', 'NO_1V1', 'NO_CONFIDENTIALITY', 'NO_LABOR', 'OPEN_ACTIONS'])
  assert.deepEqual(codes({ ...base, employee: { active: true, exemption: 'ATTENDANCE' } }), ['LOW_MOOD', 'NO_1V1', 'NO_CONFIDENTIALITY', 'NO_LABOR', 'OPEN_ACTIONS'])
  assert.deepEqual(codes({ ...base, employee: { active: true, exemption: 'FULL' } }), [])
  // 有劳动合同快到期的，不参与考核的也照样提醒
  const c = { id: 1, kind: 'LABOR', term: 'FIXED', startDate: '2024-01-01', endDate: '2026-11-01' }
  assert.deepEqual(codes({ ...base, contracts: [c], employee: { active: true, exemption: 'FULL' } }), ['LABOR_EXPIRING'])
})

test('导入：豁免列，正常 = 清掉', () => {
  const d = diffRecord({ exemption: '董事', exemptNote: '董事会成员' }, { exemption: 'NONE', exemptNote: null }, PROFILE_FIELDS, { today: '2026-10-20' })
  assert.deepEqual(d.changes.map(c => [c.field, c.to]), [['exemption', 'FULL'], ['exemptNote', '董事会成员']])
  assert.deepEqual(diffRecord({ exemption: '正常' }, { exemption: 'NONE' }, PROFILE_FIELDS, { today: '2026-10-20' }).changes, [])
})
