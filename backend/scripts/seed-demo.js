// 演示数据：给以虎 One 演示环境（演示财政局，虚构）的 11 个人录档案、合同、标准成本、2026 年 1 ~ 10 月的成本和 1v1 记录
// 走应用自己的 services（合同按劳动合同法校验、成本按标准生成），所以演示数据和真实录入的一样
//   平台上：docker cp scripts/seed-demo.js yh-hr:/app/scripts/ && docker exec -w /app yh-hr node scripts/seed-demo.js
//   ... --reset   先删掉这些人已有的合同、成本、1v1（只在演示环境用！）
// 按姓名找人；找不到的跳过
import { prisma } from '../src/lib/prisma.js'
import { saveContract } from '../src/services/contracts.js'
import { generate, setItem, setProfile } from '../src/services/cost.js'
import { updateProfile } from '../src/services/people.js'
import { save as saveOneOnOne } from '../src/services/oneOnOne.js'

let ctx // 以平台管理员（演示管理员）的身份录，留痕里能看到
const reset = process.argv.includes('--reset')

// 档案 + 标准月成本（月应发、社保单位、公积金单位、福利）
const PEOPLE = {
  演示管理员: { profile: { hireDate: '2019-03-01', workStartDate: '2014-07-01', regularDate: '2019-06-01', employmentType: 'FULL_TIME', level: 'P7', gender: 'M', birthDate: '1991-04-12', education: '硕士', major: '计算机技术', tags: ['平台运维', '数据治理'] }, cost: [26000, 5460, 3120, 600] },
  郑国栋: { profile: { hireDate: '2010-07-01', workStartDate: '2002-07-01', regularDate: '2010-10-01', employmentType: 'FULL_TIME', level: 'M4', gender: 'M', birthDate: '1979-09-03', education: '博士', major: '财政学', tags: ['预算改革', '分管领导'] }, cost: [42000, 8820, 5040, 1200] },
  李文清: { profile: { hireDate: '2015-09-01', workStartDate: '2009-07-01', regularDate: '2015-12-01', employmentType: 'FULL_TIME', level: 'M2', gender: 'F', birthDate: '1986-02-21', education: '硕士', major: '会计学', tags: ['部门预算', '项目评审'] }, cost: [28000, 5880, 3360, 800] },
  王思琪: { profile: { hireDate: '2026-08-17', workStartDate: '2023-07-01', employmentType: 'FULL_TIME', level: 'P4', gender: 'F', birthDate: '2000-11-08', education: '本科', major: '财务管理', tags: ['新人'] }, cost: [13000, 2730, 1560, 400] },
  赵立恒: { profile: { hireDate: '2012-04-01', workStartDate: '2006-07-01', regularDate: '2012-07-01', employmentType: 'FULL_TIME', level: 'M2', gender: 'M', birthDate: '1983-06-30', education: '本科', major: '金融学', tags: ['国库集中支付', '内控'] }, cost: [29000, 6090, 3480, 800] },
  陈雨桐: { profile: { hireDate: '2022-05-09', workStartDate: '2020-07-01', regularDate: '2022-08-09', employmentType: 'FULL_TIME', level: 'P5', gender: 'F', birthDate: '1997-03-15', education: '本科', major: '会计学', tags: ['支付审核'] }, cost: [16500, 3465, 1980, 400] },
  刘建华: { profile: { hireDate: '2014-03-01', workStartDate: '2005-07-01', regularDate: '2014-06-01', employmentType: 'FULL_TIME', level: 'M2', gender: 'M', birthDate: '1982-12-02', education: '硕士', major: '公共管理', tags: ['绩效评价', '第三方机构管理'] }, cost: [28500, 5985, 3420, 800] },
  周晓: { profile: { hireDate: '2024-07-01', workStartDate: '2024-07-01', regularDate: '2025-01-01', employmentType: 'FULL_TIME', level: 'P4', gender: 'F', birthDate: '2001-05-27', education: '硕士', major: '统计学', tags: ['数据分析', 'Python'] }, cost: [15000, 3150, 1800, 400] },
  孙博文: { profile: { hireDate: '2017-11-01', workStartDate: '2011-07-01', regularDate: '2018-02-01', employmentType: 'FULL_TIME', level: 'M1', gender: 'M', birthDate: '1988-08-19', education: '硕士', major: '经济法', tags: ['政策研究', '合同审查'] }, cost: [25000, 5250, 3000, 600] },
  吴佳: { profile: { hireDate: '2020-06-15', workStartDate: '2016-07-01', regularDate: '2020-12-15', employmentType: 'FULL_TIME', level: 'P6', gender: 'F', birthDate: '1993-10-10', education: '本科', major: '软件工程', tags: ['预算一体化系统', 'Java'] }, cost: [24000, 5040, 2880, 600] },
  yiliangguo: { profile: { hireDate: '2025-02-10', workStartDate: '2018-07-01', regularDate: '2025-08-10', employmentType: 'FULL_TIME', level: 'P6', gender: 'M', education: '本科', major: '计算机科学', tags: ['平台建设'] }, cost: [25000, 5250, 3000, 600] }
}

// 合同：每种状态都有人（今天 2026-10-17 前后看）
const C = (kind, startDate, endDate, extra = {}) => ({ kind, startDate, endDate, term: endDate ? 'FIXED' : 'OPEN', ...extra })
const CONTRACTS = {
  演示管理员: [C('LABOR', '2019-03-01', '2022-02-28', { probationEnd: '2019-05-31', number: 'LD-2019-003', renewed: true }), C('LABOR', '2022-03-01', null, { number: 'LD-2022-011', renewOf: 0 }), C('CONFIDENTIALITY', '2019-03-01', null)],
  郑国栋: [C('LABOR', '2016-07-01', null, { number: 'LD-2016-001', note: '连续订立两次固定期限后转无固定期限' }), C('CONFIDENTIALITY', '2010-07-01', null), C('NON_COMPETE', '2016-07-01', null, { restrictMonths: 12, monthlyComp: 15000 })],
  李文清: [C('LABOR', '2023-09-01', '2026-12-10', { number: 'LD-2023-027', note: '到期需确认是否续签' }), C('CONFIDENTIALITY', '2015-09-01', null)],
  王思琪: [C('LABOR', '2026-08-17', '2029-08-16', { probationEnd: '2026-10-28', number: 'LD-2026-041' }), C('CONFIDENTIALITY', '2026-08-17', null)],
  赵立恒: [C('LABOR', '2018-04-01', null, { number: 'LD-2018-006' }), C('CONFIDENTIALITY', '2012-04-01', null), C('TRAINING', '2025-03-01', '2028-02-29', { serviceMonths: 36, penalty: 30000, note: '公派参加国库管理高级研修（费用 3 万元）' })],
  陈雨桐: [C('LABOR', '2022-05-09', '2025-05-08', { probationEnd: '2022-08-08', number: 'LD-2022-019', note: '到期后未续签（演示：缺劳动合同）' }), C('CONFIDENTIALITY', '2022-05-09', null)],
  刘建华: [C('LABOR', '2021-03-01', '2026-11-30', { number: 'LD-2021-008', renewed: true }), C('LABOR', '2026-12-01', '2031-11-30', { number: 'LD-2026-052', signedDate: '2026-10-09', renewOf: 0 }), C('CONFIDENTIALITY', '2014-03-01', null)],
  周晓: [C('LABOR', '2024-07-01', '2027-06-30', { probationEnd: '2024-12-31', number: 'LD-2024-033' }), C('CONFIDENTIALITY', '2024-07-01', null), C('IP', '2024-07-01', null)],
  孙博文: [C('LABOR', '2023-11-01', null, { number: 'LD-2023-035' })],
  吴佳: [C('LABOR', '2023-06-15', '2027-06-14', { number: 'LD-2023-021' }), C('CONFIDENTIALITY', '2020-06-15', null), C('NON_COMPETE', '2020-06-15', null, { restrictMonths: 24, monthlyComp: 8000 }), C('IP', '2020-06-15', null)],
  yiliangguo: [C('LABOR', '2025-02-10', '2028-02-09', { probationEnd: '2025-08-09', number: 'LD-2025-004' }), C('CONFIDENTIALITY', '2025-02-10', null), C('IP', '2025-02-10', null)]
}

// 一次性成本：[姓名, 月份, 类别, 金额, 备注]
const EXTRA = [
  ...Object.keys(PEOPLE).filter(n => n !== '王思琪').map(n => [n, '2026-01', 'BONUS', Math.round(PEOPLE[n].cost[0] * (n === '郑国栋' ? 3 : 2)), '2025 年度绩效奖金']),
  ...Object.keys(PEOPLE).filter(n => !['王思琪'].includes(n)).map(n => [n, '2026-07', 'BONUS', Math.round(PEOPLE[n].cost[0] * 0.5), '上半年绩效']),
  ['赵立恒', '2026-03', 'TRAINING', 6800, '内控管理专题培训'],
  ['周晓', '2026-05', 'TRAINING', 3200, '统计分析软件认证'],
  ['吴佳', '2026-04', 'TRAINING', 4500, '信创数据库培训'],
  ['刘建华', '2026-09', 'TRAINING', 2600, '预算绩效评价师'],
  ['王思琪', '2026-08', 'RECRUIT', 6000, '校招渠道费'],
  ['王思琪', '2026-08', 'EQUIPMENT', 7999, '笔记本电脑'],
  ['周晓', '2026-06', 'EQUIPMENT', 2499, '显示器'],
  ['演示管理员', '2026-02', 'OTHER', 1500, '外出调研差旅'],
  ...Object.keys(PEOPLE).map(n => [n, '2026-06', 'BENEFIT', 1200, '年度体检']).filter(([n]) => n !== '王思琪')
]
// 1v1：[负责人, 同事, 日期, 分钟, 状态, 话题, 纪要, 待办 [文字, 谁, 期限, 完成], 下次, 私人备注]
const E = 'EMPLOYEE', M = 'MANAGER'
const ONE_ON_ONES = [
  ['郑国栋', '李文清', '2026-09-08', 45, 4, ['工作进展', '目标与优先级'], '2027 年部门预算编制启动，预算科牵头。一上口径已下发，重点单位提前沟通。', [['整理一上口径答疑清单', E, '2026-09-20', true], ['协调信息中心排期预算系统升级', M, '2026-09-30', true]], '2026-10-13'],
  ['郑国栋', '李文清', '2026-10-13', 40, 3, ['工作进展', '困难与支持'], '一上汇总中，三家单位报送延迟。人手偏紧，王思琪在试用期，能分担的有限。', [['对延迟单位发催报函', E, '2026-10-20', false], ['评估是否从国库科临时借调一人', M, '2026-10-24', false]], '2026-11-10', '李文清合同 12 月到期，下次 1v1 前和人事确认续签'],
  ['郑国栋', '赵立恒', '2026-09-22', 30, 4, ['工作进展', '团队协作'], '直达资金监控运行平稳；年底集中支付高峰预案已做。', [['年底支付高峰值班表', E, '2026-11-15', false]], '2026-10-27'],
  ['郑国栋', '刘建华', '2026-10-09', 35, 5, ['工作进展', '职业发展'], '第三方评价项目按期验收。续签合同已签。提到想牵头做全过程绩效管理的试点。', [['写一页全过程绩效试点设想', E, '2026-10-31', false]], '2026-11-06'],
  ['郑国栋', '孙博文', '2026-08-20', 30, 3, ['工作进展'], '政府采购合同范本修订进入征求意见。', [['汇总各科室修改意见', E, '2026-09-10', true]], '2026-09-17', '已超期，需要约下一次'],
  ['李文清', '王思琪', '2026-08-24', 30, 4, ['目标与优先级', '成长与学习'], '入职第一周：熟悉预算编制流程和系统操作，导师是李文清本人。', [['读完部门预算编制手册', E, '2026-09-04', true], ['开通预算系统账号', M, '2026-08-26', true]], '2026-09-21'],
  ['李文清', '王思琪', '2026-09-21', 30, 4, ['工作进展', '反馈'], '能独立完成两家单位的一上审核，细致；口径问题多问。', [['跟一次项目评审会', E, '2026-10-15', true]], '2026-10-16'],
  ['李文清', '王思琪', '2026-10-16', 40, 5, ['成长与学习', '职业发展'], '试用期 10 月 28 日到，表现达到转正要求，下周写转正评估。', [['提交试用期工作小结', E, '2026-10-23', false], ['写转正评估意见', M, '2026-10-26', false]], '2026-11-13'],
  ['赵立恒', '陈雨桐', '2026-08-12', 30, 3, ['工作进展'], '支付审核量大，加班较多。', [['梳理可下放到系统校验的审核项', E, '2026-09-01', true]], '2026-09-09'],
  ['赵立恒', '陈雨桐', '2026-09-30', 45, 2, ['状态与生活', '困难与支持', '职业发展'], '状态不太好：连续加班，另外问到合同到期后一直没有续签，担心。已答应和人事确认。', [['和人事确认续签安排', M, '2026-10-10', false], ['十月调休两天', E, '2026-10-31', false]], '2026-10-21', '有离职风险；合同 2025 年 5 月到期后未续签，要尽快补'],
  ['刘建华', '周晓', '2026-09-03', 30, 4, ['工作进展', '成长与学习'], '负责的 12 个项目绩效自评复核完成，数据分析做得好。', [['把复核模板沉淀成工具', E, '2026-09-30', true]], '2026-10-08'],
  ['刘建华', '周晓', '2026-10-08', 30, 4, ['职业发展'], '想往绩效评价数据方向发展，可以参与全过程绩效试点的数据部分。', [['报名预算绩效评价师', E, '2026-11-30', false]], '2026-11-05'],
  ['演示管理员', '吴佳', '2026-09-15', 40, 4, ['工作进展', '目标与优先级'], '预算一体化系统信创迁移，数据库切换方案评审通过。', [['切换演练两次', E, '2026-10-20', false], ['申请演练环境资源', M, '2026-09-25', true]], '2026-10-20'],
  ['演示管理员', 'yiliangguo', '2026-10-12', 30, 4, ['工作进展'], '以虎 One 平台接入人事考勤、合同和人员成本模块，准备给领导演示。', [['准备演示数据', E, '2026-10-17', true]], '2026-11-09']
]

const MONTHS = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)

async function main() {
  const emps = await prisma.employee.findMany()
  const byName = new Map(emps.map(e => [e.name, e]))
  const admin = byName.get('演示管理员') || emps[0]
  ctx = { user: { id: admin.id, name: admin.name, roles: ['ADMIN'] }, via: 'SYSTEM', ip: '127.0.0.1' }
  const ids = Object.keys(PEOPLE).map(n => byName.get(n)?.id).filter(Boolean)
  const missing = Object.keys(PEOPLE).filter(n => !byName.has(n))
  if (missing.length) console.log(`找不到这些人，跳过：${missing.join('、')}`)
  const existing = await prisma.contract.count({ where: { userId: { in: ids }, deletedAt: null } }) + await prisma.costItem.count({ where: { userId: { in: ids } } })
  const only1v1 = process.argv.includes('--1v1') // 只补 1v1（合同和成本已经录过）
  if (existing && !reset && !only1v1) throw new Error(`这些人已经有 ${existing} 条合同 / 成本数据。演示环境要重来加 --reset，只补 1v1 加 --1v1`)
  if (only1v1) {
    if (await prisma.oneOnOne.count({ where: { userId: { in: ids }, deletedAt: null } })) throw new Error('这些人已经有 1v1 记录了')
    return console.log(`1v1 ${await seedOneOnOnes(byName)} 条`)
  }
  if (reset) {
    await prisma.contract.deleteMany({ where: { userId: { in: ids } } })
    await prisma.costItem.deleteMany({ where: { userId: { in: ids } } })
    await prisma.costProfile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.oneOnOne.deleteMany({ where: { userId: { in: ids } } })
    console.log('已清掉这些人原有的合同、成本和 1v1')
  }
  let nContracts = 0
  for (const [name, p] of Object.entries(PEOPLE)) {
    const e = byName.get(name)
    if (!e) continue
    await updateProfile(ctx, e.id, p.profile)
    const [salary, social, housing, benefit] = p.cost
    await setProfile(ctx, e.id, { salary, social, housing, benefit, note: '演示数据' })
    const made = []
    for (const c of CONTRACTS[name] || []) {
      const { renewed, renewOf, ...body } = c
      if (renewOf !== undefined) body.renewOfId = made[renewOf]
      if (!body.signedDate) body.signedDate = body.startDate
      const r = await saveContract(ctx, { ...body, userId: e.id })
      made.push(r.contract.id)
      nContracts++
      for (const w of r.warnings) console.log(`  提醒（${name}）：${w}`)
    }
  }
  let nGen = 0
  for (const m of MONTHS) nGen += (await generate(ctx, { month: m, preview: false })).count
  for (const [name, month, category, amount, note] of EXTRA) {
    const e = byName.get(name)
    if (!e) continue
    const cur = await prisma.costItem.findUnique({ where: { userId_month_category: { userId: e.id, month, category } } })
    await setItem(ctx, { userId: e.id, month, category, amount: Number(cur?.amount || 0) + amount, note })
  }
  const n1v1 = await seedOneOnOnes(byName)
  const total = await prisma.costItem.aggregate({ where: { userId: { in: ids } }, _sum: { amount: true } })
  console.log(`档案 ${ids.length} 人、合同 ${nContracts} 份、标准成本 ${ids.length} 人；按标准生成 ${nGen} 个数 + 一次性 ${EXTRA.length} 个；1v1 ${n1v1} 条；2026 年 1 ~ 10 月合计 ${Number(total._sum.amount).toLocaleString('zh-CN')} 元`)
}

/** 以负责人本人的身份记（演示脚本里给他临时的人事权限，不然要他先登录过才知道他是哪个部门的负责人） */
async function seedOneOnOnes(byName) {
  let n = 0
  for (const [mgr, who, date, minutes, mood, topics, notes, actions, nextDate, privateNote] of ONE_ON_ONES) {
    const m = byName.get(mgr), e = byName.get(who)
    if (!m || !e) continue
    const mctx = { user: { id: m.id, name: m.name, roles: ['ADMIN'] }, via: 'SYSTEM', ip: '127.0.0.1' }
    await saveOneOnOne(mctx, { userId: e.id, date, minutes, mood, topics, notes, privateNote, nextDate, shared: true, actions: actions.map(([text, owner, due, done]) => ({ text, owner, due, done })) })
    n++
  }
  return n
}

main().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
