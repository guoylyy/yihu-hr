// 本地开发的模拟数据（只在本地开发模式用：没配 YH_CLIENT_ID、不是生产环境）：
//   20 来个人（几个部门、负责人）、8 月 1 日到今天的打卡（三家来源，带迟到早退缺卡、地点异常）、
//   请假 / 出差 / 外出（走 saveAbsences，和真同步一样会扣年假余额，含提前请好的）、国庆节假日、年假发放
// 用法：cd backend && node scripts/seed-local.js        重复跑会先删掉上次生成的（id ≥ 101 的人、mock: 开头的记录）
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dayInTz, eachDay, zonedTime } from '../src/lib/dates.js'
import { saveAbsences } from '../src/services/absences.js'
import { workdayFn } from '../src/services/holidays.js'
import { grantAnnual } from '../src/services/balance.js'
import { seedLeaveTypes } from '../src/services/leave.js'

if (process.env.YH_CLIENT_ID || process.env.NODE_ENV === 'production') {
  console.error('只在本地开发模式用（没配 YH_CLIENT_ID、不是生产环境）')
  process.exit(1)
}

const TZ = 'Asia/Shanghai'
const FROM = '2026-08-01'
const TODAY = dayInTz(new Date(), TZ)
const AHEAD = addDays(TODAY, 30)

// 可重复的伪随机
let seed = 20261020
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (list) => list[Math.floor(rand() * list.length)]
const between = (a, b) => a + Math.floor(rand() * (b - a + 1))
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

const DEPTS = {
  1: { name: '人事部', path: '公司/人事部' },
  10: { name: '研发部', path: '公司/研发部' },
  11: { name: '前端组', path: '公司/研发部/前端组' },
  12: { name: '后端组', path: '公司/研发部/后端组' },
  20: { name: '销售部', path: '公司/销售部' },
  21: { name: '华东大区', path: '公司/销售部/华东大区' },
  30: { name: '财务部', path: '公司/财务部' },
  40: { name: '董事会', path: '公司/董事会' }
}
// [姓名, 部门, 打卡来源, 负责的部门, 档案]（档案故意有几个人没填，智能导入时能看到）
const PEOPLE = [
  ['周建国', 10, 'DINGTALK', [10], { hireDate: '2016-03-01', workStartDate: '2009-07-01', level: 'M3', education: '硕士', gender: 'M', birthDate: '1986-05-12' }],
  ['吴晓燕', 11, 'DINGTALK', [11], { hireDate: '2019-06-17', workStartDate: '2014-07-01', level: 'M1', education: '本科', gender: 'F', birthDate: '1991-02-03' }],
  ['郑浩', 11, 'DINGTALK', [], { hireDate: '2022-07-04', workStartDate: '2020-07-01', level: 'P5', education: '本科', gender: 'M', birthDate: '1997-09-21' }],
  ['孙悦', 11, 'DINGTALK', [], { hireDate: '2024-03-11', workStartDate: '2023-07-01', level: 'P4', education: '本科', gender: 'F', birthDate: '2000-12-01' }],
  ['马超', 11, 'DINGTALK', [], { hireDate: '2026-09-01', employmentType: 'INTERN', education: '硕士', gender: 'M' }],
  ['黄磊', 12, 'FEISHU', [12], { hireDate: '2018-01-08', workStartDate: '2011-07-01', level: 'M2', education: '硕士', gender: 'M', birthDate: '1988-07-30' }],
  ['林婷', 12, 'FEISHU', [], { hireDate: '2021-04-19', workStartDate: '2017-07-01', level: 'P6', education: '本科', gender: 'F', birthDate: '1994-04-14' }],
  ['何俊', 12, 'FEISHU', [], { hireDate: '2023-02-20', workStartDate: '2019-07-01', level: 'P5', education: '本科', gender: 'M' }],
  ['罗佳', 12, 'FEISHU', [], {}],
  ['高明', 12, 'FEISHU', [], { hireDate: '2025-05-06' }],
  ['谢芳', 20, 'WECOM', [20], { hireDate: '2015-08-03', workStartDate: '2008-07-01', level: 'M3', education: '本科', gender: 'F', birthDate: '1985-10-09' }],
  ['韩冰', 21, 'WECOM', [21], { hireDate: '2017-11-13', workStartDate: '2012-07-01', level: 'M1', education: '大专', gender: 'M', birthDate: '1990-01-25' }],
  ['唐丽', 21, 'WECOM', [], { hireDate: '2020-09-07', workStartDate: '2016-07-01', level: 'S4', education: '本科', gender: 'F' }],
  ['冯涛', 21, 'WECOM', [], { hireDate: '2024-10-14', workStartDate: '2021-07-01', level: 'S2', education: '大专', gender: 'M' }],
  ['曹雪', 21, 'WECOM', [], {}],
  ['邓伟', 21, 'WECOM', [], { hireDate: '2026-07-01', workStartDate: '2026-07-01', education: '本科' }],
  ['许静', 30, 'FEISHU', [30], { hireDate: '2014-04-01', workStartDate: '2006-07-01', level: 'M2', education: '硕士', gender: 'F', birthDate: '1983-03-18' }],
  ['袁野', 30, 'FEISHU', [], { hireDate: '2022-11-21', workStartDate: '2018-07-01', level: 'P5', education: '本科', gender: 'M' }],
  ['蒋欣', 1, 'DINGTALK', [], { hireDate: '2023-06-05', workStartDate: '2019-07-01', level: 'P4', education: '本科', gender: 'F' }],
  ['沈阳', 10, 'DINGTALK', [], { hireDate: '2020-02-24', workStartDate: '2015-07-01', level: 'P7', education: '博士', gender: 'M', birthDate: '1989-11-11' }],
  // 豁免：两位董事（不参与考核，偶尔打卡），一位高管（免考勤）
  ['钱振华', 40, 'DINGTALK', [], { hireDate: '2012-01-01', gender: 'M', birthDate: '1965-03-02', exemption: 'FULL', exemptNote: '董事会成员' }],
  ['顾雅琴', 40, 'FEISHU', [], { hireDate: '2018-06-01', gender: 'F', birthDate: '1970-08-19', exemption: 'FULL', exemptNote: '独立董事' }],
  ['陆子昂', 10, 'DINGTALK', [], { hireDate: '2013-05-01', workStartDate: '2005-07-01', level: 'M5', education: '硕士', gender: 'M', birthDate: '1980-02-14', exemption: 'ATTENDANCE', exemptNote: 'CTO，弹性工作' }]
]
const OFFICE = { DINGTALK: '总部大厦 12F', FEISHU: '总部大厦 15F', WECOM: '华东办事处' }

async function reset() {
  const old = (await prisma.employee.findMany({ where: { id: { gte: 101 } }, select: { id: true } })).map(e => e.id)
  const abs = (await prisma.absence.findMany({ where: { externalId: { startsWith: 'mock:' } }, select: { id: true } })).map(a => a.id)
  await prisma.leaveLedger.deleteMany({ where: { OR: [{ absenceId: { in: abs } }, { userId: { in: old } }] } })
  await prisma.absence.deleteMany({ where: { id: { in: abs } } })
  await prisma.punch.deleteMany({ where: { externalId: { startsWith: 'mock:' } } })
  await prisma.employee.deleteMany({ where: { id: { in: old } } })
}

async function main() {
  await seedLeaveTypes()
  await reset()
  // 国庆节（模拟）：10-01 ~ 10-07 放假，09-27 周日、10-10 周六上班
  for (const d of eachDay('2026-10-01', '2026-10-07')) await prisma.holiday.upsert({ where: { date: d }, create: { date: d, kind: 'HOLIDAY', name: '国庆节' }, update: { kind: 'HOLIDAY', name: '国庆节' } })
  for (const d of ['2026-09-27', '2026-10-10']) await prisma.holiday.upsert({ where: { date: d }, create: { date: d, kind: 'WORKDAY', name: '国庆调休' }, update: { kind: 'WORKDAY', name: '国庆调休' } })

  const people = PEOPLE.map(([name, dept, source, leaderOf, profile], i) => {
    const id = 101 + i
    const d = DEPTS[dept]
    const key = { DINGTALK: 'dingUserId', FEISHU: 'feishuUserId', WECOM: 'wecomUserId' }[source]
    return {
      source, profile,
      row: {
        id, name, jobNumber: `E${String(id).padStart(4, '0')}`, title: leaderOf.length ? `${d.name}负责人` : null,
        deptId: dept, deptPath: d.path, depts: [{ id: dept, name: d.name, path: d.path, isPrimary: true }], leaderOf, active: true,
        [key]: `mock-${id}`, ...(source === 'FEISHU' ? { feishuOpenId: `ou_mock_${id}` } : {}),
        ...Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, /Date$/.test(k) ? new Date(v + 'T00:00:00Z') : v]))
      }
    }
  })
  for (const p of people) await prisma.employee.create({ data: p.row })
  // 本地开发的你（DEV_USER_ID=1）也顺便当一下研发部负责人看团队：用 DEV_LEADER_OF=10 启动即可

  const isWork = await workdayFn()
  const at = (d, t) => zonedTime(d, t, TZ)

  // 请假 / 出差 / 外出
  const absences = []
  const add = (p, a) => absences.push({ source: p.source, externalId: `mock:${p.row.id}:${absences.length}`, vendorUserId: 'mock', userId: p.row.id, approvalId: null, raw: { mock: true }, days: null, hours: null, startAt: null, endAt: null, ...a })
  const workdaysIn = (from, to) => eachDay(from, to).filter(isWork)
  for (const p of people) {
    const n = between(1, 4)
    for (let k = 0; k < n; k++) {
      const start = pick(workdaysIn(FROM, AHEAD))
      const r = rand()
      if (r < 0.35) {
        // 整天的年假 / 事假 / 病假，1 ~ 3 天
        const len = between(1, 3)
        const end = workdaysIn(start, addDays(start, 10))[len - 1] || start
        const type = pick(['年假', '年假', '事假', '病假', '调休'])
        add(p, { category: 'LEAVE', typeName: type, startDate: start, endDate: end, startAt: at(start, '09:00'), endAt: at(end, '18:00'), days: workdaysIn(start, end).length })
      } else if (r < 0.55) {
        // 半天
        const am = rand() < 0.5
        add(p, { category: 'LEAVE', typeName: pick(['年假', '事假', '调休']), startDate: start, endDate: start, startAt: at(start, am ? '09:00' : '13:30'), endAt: at(start, am ? '12:00' : '18:00'), days: 0.5 })
      } else if (r < 0.65) {
        // 按小时
        const h = between(1, 3)
        add(p, { category: 'LEAVE', typeName: '事假', startDate: start, endDate: start, startAt: at(start, '14:00'), endAt: at(start, hm(14 * 60 + h * 60)), hours: h })
      } else if (r < 0.85) {
        // 出差 2 ~ 4 天（可能跨周末）
        const end = addDays(start, between(1, 4))
        add(p, { category: 'TRIP', typeName: '出差', startDate: start, endDate: end, startAt: at(start, '08:00'), endAt: at(end, '20:00') })
      } else {
        add(p, { category: 'OUT', typeName: '外出', startDate: start, endDate: start, startAt: at(start, '14:00'), endAt: at(start, '17:00'), hours: 3 })
      }
    }
  }
  // 企业微信是按天给的：把 WECOM 的人的记录拆成每天一条、没有起止时刻
  const final = []
  for (const a of absences) {
    if (a.source !== 'WECOM' || a.startDate === a.endDate) { final.push(a.source === 'WECOM' ? { ...a, startAt: null, endAt: null } : a); continue }
    for (const d of eachDay(a.startDate, a.endDate)) final.push({ ...a, externalId: `${a.externalId}:${d}`, startDate: d, endDate: d, startAt: null, endAt: null, days: 1, hours: null })
  }

  // 先发年假（扣减才有余额可扣），再存请假
  const ctx = { user: { id: 1, name: '本地开发', roles: ['ADMIN'] }, via: 'WEB' }
  await grantAnnual(ctx, { year: 2026, userIds: people.map(p => p.row.id) })
  for (const p of people.slice(0, 12)) await prisma.leaveLedger.create({ data: { userId: p.row.id, year: 2026, typeCode: 'COMP', delta: pick([1, 1.5, 2, 3]), kind: 'ADJUST', note: '模拟：加班转调休', createdBy: 1 } })
  await saveAbsences(final)

  // 打卡：8 月 1 日到今天的工作日；整天请假 / 出差的不打卡
  const fullDay = new Set()
  for (const a of final) {
    if (a.category === 'OUT' || a.hours || (a.days != null && a.days < 1)) continue
    for (const d of eachDay(a.startDate, a.endDate)) fullDay.add(`${a.userId}:${d}`)
  }
  const punches = []
  for (const p of people) {
    const sloppy = rand() < 0.25 // 有几个人经常迟到
    for (const d of eachDay(FROM, TODAY)) {
      if (!isWork(d) || fullDay.has(`${p.row.id}:${d}`)) continue
      if (p.profile.hireDate && p.profile.hireDate > d) continue
      if (rand() < 0.01) continue // 偶尔整天没记录
      if (p.profile.exemption === 'FULL' && rand() < 0.85) continue // 董事很少打卡
      const plan = { IN: at(d, '09:00'), OUT: at(d, '18:00') }
      let inMin = between(8 * 60 + 25, 8 * 60 + 59)
      let inRes = 'NORMAL'
      const r = rand()
      if (r < (sloppy ? 0.18 : 0.04)) { inMin = between(9 * 60 + 1, 9 * 60 + 40); inRes = 'LATE' }
      else if (r < (sloppy ? 0.2 : 0.045)) { inMin = between(10 * 60 + 5, 11 * 60); inRes = 'SERIOUS_LATE' }
      let outMin = between(18 * 60, 20 * 60 + 30)
      let outRes = 'NORMAL'
      const r2 = rand()
      if (r2 < 0.025) { outMin = between(16 * 60 + 30, 17 * 60 + 50); outRes = 'EARLY' }
      else if (r2 < 0.05) outRes = 'MISSING'
      const loc = rand() < 0.03 ? 'LOCATION' : null
      const base = { source: p.source, userId: p.row.id, workDate: d, raw: { mock: true } }
      punches.push({ ...base, externalId: `mock:${p.row.id}:${d}:IN`, kind: 'IN', checkTime: at(d, hm(inMin)), planTime: plan.IN, result: loc && inRes === 'NORMAL' ? 'LOCATION' : inRes, location: loc ? '星巴克（创智天地店）' : OFFICE[p.source] })
      // 今天还没下班
      if (d === TODAY) continue
      punches.push({ ...base, externalId: `mock:${p.row.id}:${d}:OUT`, kind: 'OUT', checkTime: outRes === 'MISSING' ? null : at(d, hm(outMin)), planTime: plan.OUT, result: outRes, location: outRes === 'MISSING' ? null : OFFICE[p.source] })
    }
  }
  for (let i = 0; i < punches.length; i += 500) await prisma.punch.createMany({ data: punches.slice(i, i + 500) })

  console.log(`✓ ${people.length} 人、${punches.length} 条打卡、${final.length} 条请假 / 出差 / 外出（${FROM} ~ ${TODAY}，请假到 ${AHEAD}）`)
  console.log('  部门负责人：周建国（研发部）、吴晓燕（前端组）、黄磊（后端组）、谢芳（销售部）、韩冰（华东大区）、许静（财务部）')
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
