import test from 'node:test'
import assert from 'node:assert/strict'
import { PROFILE_FIELDS, balanceFields, diffRecord, guessMapping, matchEmployee, normalizeValue, parseDate, parseEducation, parseEmployment, parseYears, yearsAgo } from '../src/lib/importer.js'

const FIELDS = [...PROFILE_FIELDS, ...balanceFields([{ code: 'ANNUAL', name: '年假', balanced: true }, { code: 'COMP', name: '调休', balanced: true }, { code: 'SICK', name: '病假', balanced: false }])]
const f = (k) => FIELDS.find(x => x.key === k)

test('表头对字段：完全相同优先，再看包含；一个字段只给一列', () => {
  const m = guessMapping(['序号', '姓名', '员工编号', '部门', '入职时间（必填）', '首次参加工作日期', '最高学历', '剩余年假', '调休余额', '手机号', '工龄'], FIELDS)
  assert.deepEqual(m, [null, 'name', 'jobNumber', null, 'hireDate', 'workStartDate', 'education', 'balance:ANNUAL', 'balance:COMP', null, 'workYears'])
  assert.deepEqual(guessMapping(['入职日期', '入职时间'], FIELDS), ['hireDate', null])
})

test('日期的各种写法', () => {
  for (const v of ['2021-03-05', '2021/3/5', '2021.3.5', '2021年3月5日', '20210305', '2021-03-05 00:00:00', '3/5/2021', 44260]) assert.equal(parseDate(v), '2021-03-05', String(v))
  assert.equal(parseDate('2021年3月'), '2021-03-01')
  assert.equal(parseDate('2021-02-30'), null)
  assert.equal(parseDate('去年'), null)
})

test('学历、用工类型、工龄', () => {
  assert.equal(parseEducation('全日制本科'), '本科')
  assert.equal(parseEducation('研究生'), '硕士')
  assert.equal(parseEducation('中专'), '高中及以下')
  assert.equal(parseEducation('其他'), null)
  assert.equal(parseEmployment('正式员工'), 'FULL_TIME')
  assert.equal(parseEmployment('劳务派遣'), 'OUTSOURCED')
  assert.equal(parseEmployment('intern'), 'INTERN')
  assert.equal(parseYears('8年3个月'), 8.25)
  assert.equal(yearsAgo('2026-10-20', 8.25), '2018-07-01')
})

test('规范值：空的跳过，看不懂的报出来，余额取到半天', () => {
  assert.deepEqual(normalizeValue(f('hireDate'), '—'), { empty: true })
  assert.deepEqual(normalizeValue(f('hireDate'), '上个月'), { error: true })
  assert.deepEqual(normalizeValue(f('gender'), '女'), { value: 'F' })
  assert.deepEqual(normalizeValue(f('balance:ANNUAL'), '5.3 天'), { value: 5.5 })
  assert.deepEqual(normalizeValue(f('tags'), 'Java、带团队, 英语'), { value: ['Java', '带团队', '英语'] })
})

test('对人：工号优先，重名要工号', () => {
  const emps = [{ id: 1, name: '张三', jobNumber: 'E01' }, { id: 2, name: '张三', jobNumber: 'E02' }, { id: 3, name: '李四', jobNumber: null }]
  assert.equal(matchEmployee({ name: '张三', jobNumber: 'E02' }, emps).employee.id, 2)
  assert.match(matchEmployee({ name: '张三' }, emps).error, /2 个/)
  assert.equal(matchEmployee({ name: '李四' }, emps).employee.id, 3)
  assert.match(matchEmployee({ name: '王五' }, emps).error, /找不到/)
})

test('比出要改的：一样的不改，工龄只在没给参加工作日期时推算', () => {
  const cur = { hireDate: '2021-03-05', workStartDate: null, education: '本科', tags: ['Java'], 'balance:ANNUAL': 3 }
  const d = diffRecord({ hireDate: '2021/3/5', education: '硕士', tags: 'Java', workYears: '10', 'balance:ANNUAL': '5', birthDate: '不详' }, cur, FIELDS, { today: '2026-10-20' })
  assert.deepEqual(d.changes.map(c => [c.field, c.from, c.to]), [['education', '本科', '硕士'], ['workStartDate', null, '2016-10-01'], ['balance:ANNUAL', 3, 5]])
  assert.equal(d.changes.find(c => c.field === 'workStartDate').derived, f('workYears').label)
  assert.deepEqual(d.unparsed.map(u => u.field), ['birthDate'])
  const d2 = diffRecord({ workYears: '10', workStartDate: '2015-07-01' }, {}, FIELDS, { today: '2026-10-20' })
  assert.deepEqual(d2.changes.map(c => [c.field, c.to]), [['workStartDate', '2015-07-01']])
})
