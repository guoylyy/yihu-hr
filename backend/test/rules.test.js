import test from 'node:test'
import assert from 'node:assert/strict'
import { membersUnder } from '../src/services/access.js'
import { parseHolidayText } from '../src/services/holidays.js'

const emps = [
  { id: 1, active: true, depts: [{ id: 10, path: '公司/研发' }] },
  { id: 2, active: true, depts: [{ id: 11, path: '公司/研发/前端' }] },
  { id: 3, active: true, depts: [{ id: 12, path: '公司/研发部' }] },
  { id: 4, active: false, depts: [{ id: 11, path: '公司/研发/前端' }] },
  { id: 5, active: true, depts: [{ id: 20, path: '公司/销售' }] }
]

test('负责人看本部门和下级部门，不含同名前缀的别的部门、不含离职的', () => {
  assert.deepEqual(membersUnder([10], emps).map(e => e.id), [1, 2])
  assert.deepEqual(membersUnder([11], emps).map(e => e.id), [2])
  assert.deepEqual(membersUnder([], emps), [])
})

test('节假日批量录入', () => {
  const { rows, errors } = parseHolidayText('# 2026 国庆\n2026-10-01 休 国庆节\n2026-10-10,班,国庆调休\n2026-10-02 HOLIDAY\n')
  assert.deepEqual(errors, [])
  assert.deepEqual(rows, [
    { date: '2026-10-01', kind: 'HOLIDAY', name: '国庆节' },
    { date: '2026-10-10', kind: 'WORKDAY', name: '国庆调休' },
    { date: '2026-10-02', kind: 'HOLIDAY', name: null }
  ])
  assert.equal(parseHolidayText('2026-13-01 休').errors.length, 1)
})
