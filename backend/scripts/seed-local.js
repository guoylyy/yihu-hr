// 本地开发的模拟数据（只在本地开发模式用：没配 YH_CLIENT_ID、不是生产环境）：
//   20 来个人（几个部门、负责人）、8 月 1 日到今天的打卡（三家来源，带迟到早退缺卡、地点异常）、
//   请假 / 出差 / 外出（走 saveAbsences，和真同步一样会扣年假余额，含提前请好的）、国庆节假日、年假发放、
//   1v1 记录（大部分是「导入会议纪要」的：纪要全文 + 模型整理出的要点、待办、状态；有几个人故意很久没谈）
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
  await prisma.oneOnOne.deleteMany({ where: { userId: { in: old } } })
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

  const ones = await seedOneOnOnes(people)
  console.log(`✓ ${people.length} 人、${punches.length} 条打卡、${final.length} 条请假 / 出差 / 外出（${FROM} ~ ${TODAY}，请假到 ${AHEAD}）、${ones} 条 1v1`)
  console.log('  部门负责人：周建国（研发部）、吴晓燕（前端组）、黄磊（后端组）、谢芳（销售部）、韩冰（华东大区）、许静（财务部）')
  await prisma.$disconnect()
}

// ---------- 1v1：会议纪要（飞书妙记风格的文字稿）+ 整理好的要点、待办、状态 ----------
// 每个场景给出：纪要全文、要点、话题、待办、状态和理由、给负责人的观察
const SCENES = {
  progress: (e, m, d) => ({
    lines: [
      [m, `${e}，最近手上的事情进展怎么样？`],
      [e, '主要在做订单导出那块，接口基本写完了，下周三能提测。就是对账那边的需求又改了一次，有点被动。'],
      [m, '需求变更这个我去和产品对一下，以后改需求要走评审。你这边还有什么卡住的？'],
      [e, '测试环境的数据不太够，造数据挺花时间的。'],
      [m, '我让测试组的同学周五前给你准备一份脱敏的数据。你把接口文档在周五前补齐，方便前端联调。'],
      [e, '好的。'],
      [m, '整体节奏不错，继续保持。下个月中我们再聊一次。']
    ],
    summary: ['订单导出接口基本完成，计划下周三提测', '对账需求又变更了一次，比较被动；负责人去和产品对齐，后续需求变更走评审', '测试数据不足，造数据耗时'],
    topics: ['工作进展', '困难与支持'],
    actions: [['补齐订单导出的接口文档，方便前端联调', 'EMPLOYEE', 4], ['和产品对齐需求变更流程', 'MANAGER', 7], ['让测试组准备一份脱敏测试数据', 'MANAGER', 4]],
    mood: 4, moodReason: '对进展有把握，提到困难时语气平稳', next: 25,
    observations: ['执行力好，需求变更时能及时反馈']
  }),
  growth: (e, m, d) => ({
    lines: [
      [m, '今天主要想聊聊你自己的发展，你最近有什么想法？'],
      [e, '我想多做一些技术方案设计的事，现在大部分时间在写业务代码，感觉成长有点慢。'],
      [m, '理解。下个季度的权限系统重构，你来牵头写方案怎么样？我帮你约架构评审。'],
      [e, '可以，我挺想试试的。另外想报一个系统设计的课。'],
      [m, '培训预算是有的，你把课程信息发我，我来申请。'],
      [e, '好，谢谢。'],
      [m, '方案初稿月底前给我看一版，我们一起过。']
    ],
    summary: ['希望多做技术方案设计，觉得目前成长偏慢', '下季度权限系统重构由他牵头写方案，负责人帮忙约架构评审', '想报系统设计课程，负责人申请培训预算'],
    topics: ['成长与学习', '职业发展'],
    actions: [['权限系统重构方案初稿', 'EMPLOYEE', 12], ['把系统设计课程信息发给负责人', 'EMPLOYEE', 3], ['申请培训预算', 'MANAGER', 10], ['约架构评审', 'MANAGER', 14]],
    mood: 4, moodReason: '主动提出成长诉求，对新任务有期待', next: 30,
    observations: ['有明确的成长诉求，可以作为技术骨干培养；要及时给机会，不然容易流失']
  }),
  low: (e, m, d) => ({
    lines: [
      [m, '最近感觉你有点累，加班挺多的？'],
      [e, '嗯，上个月基本每天都到十点以后，家里也有点事，确实有点扛不住。'],
      [m, '辛苦了。是哪块的工作量最大？'],
      [e, '主要是客户那边的临时需求，一周好几个，还都要当天给。'],
      [m, '这个不合理。我和客户那边的对接人沟通一下，临时需求统一由我来排优先级，你别直接接。'],
      [e, '好，那样会好很多。'],
      [m, '这周五你调休一天休息一下。有什么想法随时找我，两周后我们再聊。'],
      [e, '谢谢。其实也有猎头找过我，我还没想好。'],
      [m, '理解，先把手上的压力降下来，我们下次细聊。']
    ],
    summary: ['上个月加班很多，加上家里有事，状态比较疲惫', '压力主要来自客户的临时需求；之后临时需求统一由负责人排优先级', '这周五调休一天', '提到有猎头接触，还没决定'],
    topics: ['状态与生活', '困难与支持', '工作进展'],
    actions: [['和客户对接人沟通临时需求的流程', 'MANAGER', 3], ['周五调休休息', 'EMPLOYEE', 3]],
    mood: 2, moodReason: '明确表示扛不住，提到猎头接触', next: 14,
    observations: ['有离职风险：猎头接触过，状态疲惫', '两周内要跟进工作量是否降下来，考虑调整分工']
  }),
  newbie: (e, m, d) => ({
    lines: [
      [m, '来了快一个多月了，感觉怎么样？'],
      [e, '整体挺好的，同事都很帮忙。就是代码库太大了，有些模块还看不太懂。'],
      [m, '正常。我让组里的老同学带你过一下架构，每周一次，持续一个月。'],
      [e, '那太好了。'],
      [m, '试用期的目标我们对一下：独立完成两个中等需求，月底前写一篇对现有模块的梳理文档。'],
      [e, '好的，我记下了。'],
      [m, '有问题别憋着，直接在群里问。']
    ],
    summary: ['入职一个多月，团队融入不错', '代码库大，部分模块还不熟；安排老同学每周带一次架构梳理，持续一个月', '对齐试用期目标：独立完成两个中等需求、写一篇模块梳理文档'],
    topics: ['目标与优先级', '成长与学习', '状态与生活'],
    actions: [['写一篇现有模块的梳理文档', 'EMPLOYEE', 20], ['安排老同学每周带一次架构梳理', 'MANAGER', 5]],
    mood: 4, moodReason: '融入顺利，态度积极', next: 30,
    observations: ['试用期重点看独立交付能力']
  }),
  feedback: (e, m, d) => ({
    lines: [
      [m, '这次主要想给你一些反馈。上个月的发布事故，复盘你看过了吧？'],
      [e, '看过了，主要是我上线前没跑完整的回归。'],
      [m, '对，这个要形成习惯。另外跨组沟通的时候，信息同步得再及时一点，那次销售那边是最后一个知道的。'],
      [e, '明白，我以后上线前在群里发一下变更说明。'],
      [m, '好。优点也说一下，你处理线上问题的速度很快，客户反馈很好。'],
      [e, '谢谢。我这边希望下个季度能少接一点零碎的需求。'],
      [m, '可以，我在排期的时候考虑。']
    ],
    summary: ['上月发布事故：上线前没跑完整回归，要形成习惯', '跨组信息同步要更及时；以后上线前在群里发变更说明', '处理线上问题速度快，客户反馈好', '希望下季度少接零碎需求'],
    topics: ['反馈', '团队协作'],
    actions: [['上线前跑完整回归，并在群里发变更说明', 'EMPLOYEE', 0], ['下季度排期时减少零碎需求', 'MANAGER', 30]],
    mood: 3, moodReason: '接受反馈，情绪平稳', next: 30,
    observations: ['责任心强，流程意识要加强']
  })
}

/** 飞书妙记风格的文字稿：标题、参会人、说话人 + 时间点 */
function transcript(title, date, lines, e, m) {
  let t = 0
  const body = lines.map(([who, text]) => {
    t += between(20, 90)
    return `${who}  ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}\n${text}`
  }).join('\n\n')
  return `${title}\n${date} · 参会人：${m}、${e}\n\n智能纪要由飞书妙记生成（模拟）\n\n文字记录\n\n${body}`
}

async function seedOneOnOnes(people) {
  const byName = new Map([...(await prisma.employee.findMany()).map(e => [e.name, e])])
  const id = (n) => byName.get(n)?.id
  // [下属, 负责人, 场景（从新到旧）]；负责人 null = 本地开发的你（人事）
  const PLAN = [
    ['郑浩', '吴晓燕', ['progress', 'feedback', 'progress']], ['孙悦', '吴晓燕', ['growth', 'progress']], ['马超', '吴晓燕', ['newbie']],
    ['林婷', '黄磊', ['low', 'progress', 'progress']], ['何俊', '黄磊', ['growth']], ['罗佳', '黄磊', ['feedback']],
    ['吴晓燕', '周建国', ['progress', 'growth']], ['黄磊', '周建国', ['progress']], ['沈阳', '周建国', ['growth', 'feedback']],
    ['唐丽', '韩冰', ['progress', 'low']], ['冯涛', '韩冰', ['feedback']], ['邓伟', '韩冰', ['newbie']], ['韩冰', '谢芳', ['progress']],
    ['袁野', '许静', ['progress']], ['蒋欣', null, ['growth']]
    // 高明、曹雪：故意没有 1v1（人员全景里会标「还没有 1v1 记录」）
  ]
  let n = 0
  for (const [who, mgr, scenes] of PLAN) {
    const uid = id(who)
    const mid = mgr ? id(mgr) : 1
    if (!uid || !mid) continue
    // 最近一次在 2 ~ 40 天前，往前每次隔 25 ~ 40 天（个别人最近一次很久以前，标「太久没谈」）
    let date = addDays(TODAY, -between(2, who === '唐丽' ? 75 : 40))
    for (const [i, key] of scenes.entries()) {
      const sc = SCENES[key](who, mgr || '本地开发', date)
      const imported = i === 0 || rand() < 0.5
      const actions = sc.actions.map(([text, owner, due]) => ({ text, owner, due: addDays(date, due), done: i > 0 || addDays(date, due) < TODAY ? rand() < 0.8 : false }))
      const summary = sc.summary.map(x => `- ${x}`).join('\n')
      await prisma.oneOnOne.create({
        data: {
          userId: uid, managerId: mid, date, minutes: between(25, 50), mood: sc.mood, topics: sc.topics, notes: summary,
          privateNote: sc.observations.map(x => `- ${x}`).join('\n'), actions, nextDate: i === 0 ? addDays(date, sc.next) : null, shared: true,
          ...(imported ? {
            sourceText: transcript(`${mgr || '本地开发'} / ${who} 1v1`, date, sc.lines, who, mgr || '本地开发'),
            // 本地没有文件存储：只有全文，没有原文件
            sourceShared: key !== 'low' && rand() < 0.3,
            parsed: { summary, topics: sc.topics, actions, mood: sc.mood, moodReason: sc.moodReason, nextDate: i === 0 ? addDays(date, sc.next) : null, observations: sc.observations.map(x => `- ${x}`).join('\n'), by: 'AI', at: new Date().toISOString() }
          } : {})
        }
      })
      n++
      date = addDays(date, -between(25, 40))
    }
  }
  return n
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
