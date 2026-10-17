import test from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, checkContract, contractStatus, maxProbationMonths, restrictWindow, termMonths } from '../src/lib/contracts.js'
import { employedIn, generateMonth, lastMonths, summarize } from '../src/lib/cost.js'
import { flagsFor, tenure, tenureBucket, yearsBetween } from '../src/lib/portrait.js'

test('加月份：月底对齐', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15')
  assert.equal(addMonths('2026-03-15', -3), '2025-12-15')
})

test('合同期限按月（不足整月向上取）', () => {
  assert.equal(termMonths('2026-01-01', '2026-12-31'), 12)
  assert.equal(termMonths('2026-01-01', '2027-01-01'), 13)
  assert.equal(termMonths('2026-01-01', '2026-03-31'), 3)
  assert.equal(termMonths('2026-01-01', '2026-03-30'), 3)
})

test('试用期上限：劳动合同法第十九条', () => {
  assert.equal(maxProbationMonths({ term: 'FIXED', startDate: '2026-01-01', endDate: '2026-02-28' }), 0)
  assert.equal(maxProbationMonths({ term: 'FIXED', startDate: '2026-01-01', endDate: '2026-06-30' }), 1)
  // 正好 1 年算「1 年以上不满 3 年」
  assert.equal(maxProbationMonths({ term: 'FIXED', startDate: '2026-01-01', endDate: '2026-12-31' }), 2)
  assert.equal(maxProbationMonths({ term: 'FIXED', startDate: '2026-01-01', endDate: '2028-12-31' }), 6)
  assert.equal(maxProbationMonths({ term: 'FIXED', startDate: '2026-01-01', endDate: '2027-12-31' }), 2)
  assert.equal(maxProbationMonths({ term: 'OPEN', startDate: '2026-01-01' }), 6)
  assert.equal(maxProbationMonths({ term: 'TASK', startDate: '2026-01-01', endDate: '2027-01-01' }), 0)
})

test('合同校验：期限、试用期、竞业限制', () => {
  const base = { kind: 'LABOR', term: 'FIXED', startDate: '2026-01-01', endDate: '2028-12-31' }
  assert.deepEqual(checkContract(base).errors, [])
  assert.match(checkContract({ ...base, endDate: null }).errors[0], /到期日/)
  assert.match(checkContract({ ...base, term: 'OPEN' }).errors[0], /不写到期日/)
  assert.deepEqual(checkContract({ ...base, probationEnd: '2026-06-30' }).errors, [])
  assert.match(checkContract({ ...base, probationEnd: '2026-07-01' }).errors[0], /最长 6 个月/)
  assert.match(checkContract({ ...base, endDate: '2026-02-15', probationEnd: '2026-01-15' }).errors[0], /不满 3 个月/)
  assert.match(checkContract({ kind: 'CONFIDENTIALITY', term: 'OPEN', startDate: '2026-01-01', probationEnd: '2026-02-01' }).errors[0], /只有劳动合同/)
  const nc = { kind: 'NON_COMPETE', term: 'OPEN', startDate: '2026-01-01', restrictMonths: 12, monthlyComp: 3000 }
  assert.deepEqual(checkContract(nc), { errors: [], warnings: [] })
  assert.match(checkContract({ ...nc, restrictMonths: 36 }).errors[0], /24 个月/)
  assert.match(checkContract({ ...nc, monthlyComp: 0 }).warnings[0], /补偿金/)
})

test('合同状态：到期提醒、解除、竞业限制按离职日', () => {
  const c = { kind: 'LABOR', startDate: '2024-01-01', endDate: '2026-12-31' }
  assert.equal(contractStatus(c, '2026-10-01', { warnDays: 60 }), 'ACTIVE')
  assert.equal(contractStatus(c, '2026-11-15', { warnDays: 60 }), 'EXPIRING')
  assert.equal(contractStatus(c, '2027-01-01'), 'EXPIRED')
  assert.equal(contractStatus({ ...c, terminatedAt: '2026-05-01' }, '2026-06-01'), 'TERMINATED')
  assert.equal(contractStatus({ ...c, startDate: '2027-01-01', endDate: null }, '2026-06-01'), 'PENDING')
  const nc = { kind: 'NON_COMPETE', startDate: '2024-01-01', restrictMonths: 6 }
  assert.equal(contractStatus(nc, '2026-06-01'), 'SIGNED')
  assert.deepEqual(restrictWindow(nc, '2026-03-15'), { from: '2026-03-15', to: '2026-09-14' })
  assert.equal(contractStatus(nc, '2026-06-01', { leaveDate: '2026-03-15' }), 'IN_FORCE')
  assert.equal(contractStatus(nc, '2026-09-15', { leaveDate: '2026-03-15' }), 'EXPIRED')
})

test('成本：在职月份、按标准生成、已有的不动、竞业补偿', () => {
  assert.equal(employedIn({ hireDate: '2026-03-20' }, '2026-03'), true)
  assert.equal(employedIn({ hireDate: '2026-04-01' }, '2026-03'), false)
  assert.equal(employedIn({ leaveDate: new Date('2026-02-28T00:00:00Z') }, '2026-03'), false)
  const employees = [{ id: 1, hireDate: '2020-01-01' }, { id: 2, hireDate: '2020-01-01', leaveDate: '2026-03-15' }, { id: 3, hireDate: '2026-11-01' }]
  const profiles = new Map([[1, { salary: 20000, social: 3200, housing: 1200, benefit: 0 }], [2, { salary: 15000 }], [3, { salary: 9000 }]])
  const contracts = [{ userId: 2, kind: 'NON_COMPETE', restrictMonths: 6, monthlyComp: 4500 }]
  const out = generateMonth({ month: '2026-05', employees, profiles, contracts, existing: new Set(['1:SOCIAL']) })
  assert.deepEqual(out.map(x => `${x.userId}:${x.category}:${x.amount}:${x.source}`), ['1:SALARY:20000:PROFILE', '1:HOUSING:1200:PROFILE', '2:NON_COMPETE:4500:CONTRACT'])
  // 竞业期过了不再生成
  assert.equal(generateMonth({ month: '2026-10', employees, profiles, contracts, existing: new Set() }).some(x => x.category === 'NON_COMPETE'), false)
})

test('成本汇总和月份序列', () => {
  const s = summarize([{ userId: 1, month: '2026-09', category: 'SALARY', amount: '100.10' }, { userId: 1, month: '2026-10', category: 'SALARY', amount: 0.2 }, { userId: 2, month: '2026-10', category: 'BONUS', amount: 50 }])
  assert.equal(s.amount, 150.3)
  assert.deepEqual(s.byCategory, { SALARY: 100.3, BONUS: 50 })
  assert.equal(s.byUser.get(1), 100.3)
  assert.deepEqual(lastMonths('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02'])
})

test('画像：司龄、年龄、分布', () => {
  assert.equal(yearsBetween('1990-10-18', '2026-10-17'), 35)
  assert.equal(yearsBetween('1990-10-17', '2026-10-17'), 36)
  assert.equal(tenure('2024-10-17', '2026-10-17'), 2)
  assert.equal(tenureBucket(0.5), '<1')
  assert.equal(tenureBucket(12), '10+')
  assert.equal(tenureBucket(null), 'unknown')
})

test('画像标记：没合同、要到期、试用期、1v1、状态、竞业', () => {
  const settings = { contractWarnDays: 60, oneOnOneCadenceDays: 30 }
  const today = '2026-10-17'
  const emp = { active: true }
  const codes = (f) => f.map(x => x.code)
  assert.deepEqual(codes(flagsFor({ employee: emp, today, settings })), ['NO_LABOR', 'NO_1V1', 'NO_CONFIDENTIALITY'])
  const labor = { id: 1, kind: 'LABOR', startDate: '2026-08-01', endDate: '2026-11-30', probationEnd: '2026-10-25' }
  const conf = { id: 2, kind: 'CONFIDENTIALITY', startDate: '2026-08-01' }
  const f = flagsFor({ employee: emp, contracts: [labor, conf], last1v1: { date: '2026-10-10', mood: 2 }, openActions: 1, abnormalDays: 4, today, settings })
  assert.deepEqual(codes(f), ['LABOR_EXPIRING', 'LOW_MOOD', 'ATTENDANCE', 'PROBATION_ENDING', 'OPEN_ACTIONS'])
  // 续签了就不提醒到期
  const renewed = { id: 3, kind: 'LABOR', startDate: '2026-12-01', endDate: '2029-11-30' }
  assert.equal(codes(flagsFor({ employee: emp, contracts: [labor, renewed, conf], last1v1: { date: '2026-10-10' }, today, settings })).includes('LABOR_EXPIRING'), false)
  // 离职的人只看竞业限制
  const nc = { id: 4, kind: 'NON_COMPETE', startDate: '2024-01-01', restrictMonths: 12, monthlyComp: 5000 }
  const gone = flagsFor({ employee: { active: false, leaveDate: '2026-06-30' }, contracts: [nc], today, settings })
  assert.deepEqual(codes(gone), ['NC_IN_FORCE'])
  assert.match(gone[0].text, /2027-06-29/)
})
