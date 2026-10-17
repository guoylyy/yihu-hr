import test from 'node:test'
import assert from 'node:assert/strict'
import { annualEntitlement, fullYears } from '../src/lib/annualLeave.js'

test('满几整年', () => {
  assert.equal(fullYears('2016-03-15', '2026-03-14'), 9)
  assert.equal(fullYears('2016-03-15', '2026-03-15'), 10)
})

test('全年在职：按工龄档位给 5 / 10 / 15 天', () => {
  assert.equal(annualEntitlement({ workStartDate: '2020-01-01', year: 2026 }).days, 5)
  assert.equal(annualEntitlement({ workStartDate: '2010-01-01', year: 2026 }).days, 10)
  assert.equal(annualEntitlement({ workStartDate: '2000-01-01', year: 2026 }).days, 15)
})

test('工龄不满 1 年没有年假', () => {
  assert.equal(annualEntitlement({ workStartDate: '2026-03-01', year: 2026 }).days, 0)
})

test('缺参加工作日期返回 null', () => {
  assert.equal(annualEntitlement({ year: 2026 }), null)
})

test('新入职按剩余日历天数折算，不足 1 天不给', () => {
  // 7/1 入职，工龄 5 年：184/365 × 5 = 2.52 → 2 天
  assert.equal(annualEntitlement({ workStartDate: '2021-01-01', hireDate: '2026-07-01', year: 2026 }).days, 2)
  // 精确到半天：2.5
  assert.equal(annualEntitlement({ workStartDate: '2021-01-01', hireDate: '2026-07-01', year: 2026, rounding: 'half' }).days, 2.5)
})

test('年中跨过档位按段折算', () => {
  // 2016-07-01 参加工作，2026-07-01 满 10 年：181 天 × 5 + 184 天 × 10 = 2745 / 365 = 7.52 → 7
  const r = annualEntitlement({ workStartDate: '2016-07-01', year: 2026 })
  assert.equal(r.days, 7)
  assert.deepEqual(r.segments.map(s => [s.from, s.to, s.perYear]), [['2026-01-01', '2026-06-30', 5], ['2026-07-01', '2026-12-31', 10]])
  // 年中满 1 年：2025-10-01 参加工作 → 2026-10-01 起每年 5 天，92/365 × 5 = 1.26 → 1
  assert.equal(annualEntitlement({ workStartDate: '2025-10-01', year: 2026 }).days, 1)
})

test('公司福利年假一起折算，只给有法定年假的时段', () => {
  assert.equal(annualEntitlement({ workStartDate: '2020-01-01', year: 2026, extraDays: 3 }).days, 8)
  assert.equal(annualEntitlement({ workStartDate: '2026-01-01', year: 2026, extraDays: 3 }).days, 0)
})

test('闰年全年也正好是档位天数', () => {
  assert.equal(annualEntitlement({ workStartDate: '2020-01-01', year: 2028 }).days, 5)
})

test('入职日期在当年之后：0 天', () => {
  assert.equal(annualEntitlement({ workStartDate: '2010-01-01', hireDate: '2027-02-01', year: 2026 }).days, 0)
})
