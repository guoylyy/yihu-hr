// AI 工具（MCP，无状态 Streamable HTTP，只回 JSON）。平台带 Bearer access_token 调用，一律以当前用户的身份和权限执行。
// 只读工具声明 readOnlyHint；会改数据的不声明，平台会先让用户确认。
// get_key_metrics / get_daily_summary / list_pending_decisions 是平台约定的标准工具（老板简报、管理层首页用）
import { ws, devUser, appUrl } from './lib/platform.js'
import { addDays, dayInTz } from './lib/dates.js'
import { prisma } from './lib/prisma.js'
import { canSeeTeam, visibleScope } from './services/access.js'
import { touchEmployee } from './services/directory.js'
import * as attendance from './services/attendance.js'
import * as leave from './services/leave.js'
import * as absences from './services/absences.js'
import { importRecords } from './services/importer.js'
import { myBalance } from './services/balance.js'
import { getSettings } from './services/settings.js'
import * as contracts from './services/contracts.js'
import * as people from './services/people.js'
import * as oneOnOne from './services/oneOnOne.js'
import { contractScope } from './services/access.js'
import { VERSION } from './lib/version.js'

const RO = { readOnlyHint: true }

/** 按 id 或姓名找一个当前用户能看的人；重名、找不到都说清楚 */
async function findPerson(ctx, { userId, name }) {
  if (userId) return Number(userId)
  if (!name) return ctx.user.id
  const scope = await visibleScope(ctx)
  const hits = await prisma.employee.findMany({ where: { name: { contains: String(name) }, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, take: 5 })
  if (!hits.length) throw Object.assign(new Error(`找不到你能看的「${name}」`), { status: 404 })
  if (hits.length > 1 && !hits.some(h => h.name === name)) throw Object.assign(new Error(`有好几个人：${hits.map(h => `${h.name}（${h.deptPath || ''}，id ${h.id}）`).join('、')}，请说清楚是哪位`), { status: 400 })
  return (hits.find(h => h.name === name) || hits[0]).id
}
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required })

const TOOLS = [
  {
    name: 'get_my_attendance',
    description: '查我（或我能看的同事）某个月的考勤：每天的上下班打卡时间、迟到早退缺卡、请假、出差、外出。用户问「我这个月考勤」「我有没有迟到」「上个月缺卡几次」时用',
    inputSchema: obj({ month: { type: 'string', description: '月份 YYYY-MM，默认本月' }, userId: { type: 'number', description: '同事的平台用户 id，默认本人' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const r = await attendance.monthOf(ctx, a)
      return {
        employee: r.employee, month: r.month, summary: r.summary,
        abnormalDays: r.days.filter(d => d.status === 'ABNORMAL').map(d => ({ date: d.date, flags: d.flags, firstIn: d.firstIn, lastOut: d.lastOut })),
        leaveAndTrips: r.absences.map(x => ({ category: x.categoryLabel, type: x.typeName, startDate: x.startDate, endDate: x.endDate, days: x.workDays, source: x.sourceLabel })),
        url: appUrl(`/my?month=${r.month}${r.employee.id !== ctx.user.id ? `&userId=${r.employee.id}` : ''}`)
      }
    }
  },
  {
    name: 'get_team_attendance',
    description: '部门负责人 / 人事查团队某一天的出勤：谁正常、谁迟到缺卡、谁请假、谁没有记录。用户问「今天谁没打卡」「部门今天出勤」时用',
    inputSchema: obj({ date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const r = await attendance.teamDay(ctx, a)
      return { date: r.date, workday: r.workday, stats: r.stats, notNormal: r.rows.filter(x => x.status !== 'NORMAL' && x.status !== 'REST').slice(0, 50).map(x => ({ name: x.employee.name, dept: x.employee.deptPath, status: x.status, flags: x.flags, firstIn: x.firstIn, lastOut: x.lastOut })) }
    }
  },
  {
    name: 'get_team_monthly_attendance',
    description: '部门负责人 / 人事查团队某个月每个人的出勤汇总：正常天数、迟到、早退、缺卡、旷工、请假天数、出差天数。用户问「这个月谁迟到最多」「上个月部门出勤怎么样」时用',
    inputSchema: obj({ month: { type: 'string', description: '月份 YYYY-MM，默认本月' }, keyword: { type: 'string', description: '按姓名 / 工号 / 部门筛' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const r = await attendance.monthlyReport(ctx, a)
      return {
        month: r.month, totals: r.totals,
        people: r.rows.slice(0, 200).map(x => ({ name: x.employee.name, dept: x.employee.deptPath, normal: x.normal, late: x.late, early: x.early, missing: x.missing, absent: x.absent, noData: x.noData, leaveDays: x.leaveDays, leaveByType: x.leaveByType, tripDays: x.tripDays })),
        url: appUrl(`/team?month=${r.month}`)
      }
    }
  },
  {
    name: 'get_my_leave_balance',
    description: '查我的假期余额（年假、调休）。用户问「我还有几天年假」时用',
    inputSchema: obj({ year: { type: 'number', description: '年份，默认今年' } }),
    annotations: RO,
    run: (ctx, a) => myBalance(ctx, a)
  },
  {
    name: 'list_leave_records',
    description: '列出我（或我能看的同事）的请假、出差、外出记录。这些都是在钉钉 / 飞书 / 企业微信里审批通过、同步过来的；本应用不能提交或审批请假，要请假请到钉钉 / 飞书 / 企业微信里提交',
    inputSchema: obj({
      userId: { type: 'number', description: '同事的平台用户 id，默认本人' }, name: { type: 'string', description: '同事姓名' },
      from: { type: 'string', description: '开始日期 YYYY-MM-DD，默认今年 1 月 1 日' }, to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
      category: { type: 'string', enum: ['LEAVE', 'TRIP', 'OUT'], description: 'LEAVE 请假 / TRIP 出差 / OUT 外出，不填全部' }
    }),
    annotations: RO,
    run: async (ctx, a) => {
      const from = a.from || `${(await contracts.today()).slice(0, 4)}-01-01`
      const rows = await absences.absencesOf(ctx, { ...a, userId: await findPerson(ctx, a), from })
      return rows.slice(0, 50).map(r => ({ category: r.categoryLabel, type: r.typeName, startDate: r.startDate, endDate: r.endDate, startAt: r.startAt, endAt: r.endAt, days: r.workDays, source: r.sourceLabel }))
    }
  },
  {
    name: 'list_leave_types',
    description: '列出本应用的假期类型（代码、名称、是否扣余额）。钉钉 / 飞书 / 企业微信里的假按名称对上这些类型',
    inputSchema: obj(),
    annotations: RO,
    run: async (ctx) => (await leave.listTypes(ctx)).map(t => ({ code: t.code, name: t.name, needsBalance: t.balanced }))
  },
  {
    name: 'import_employee_data',
    description: '人事用：把对话里给的员工信息写进档案或假期余额（比如「张三 2021-03-01 入职，本科，复旦；李四年假还剩 5 天」）。先整理成 records 调一次 preview=true 给用户看要改什么，用户确认后再 preview=false 写入。' +
      '名字和平台上不完全一样的（称呼、昵称、带备注、拼音）不会自动写，返回 needConfirm 候选：问用户是哪一位，再把那条带上 userId 重新调。' +
      '姓名、工号只用来对人（以平台为准，不改）。values 的 key：hireDate 入职日期、workStartDate 参加工作日期、regularDate 转正日期、leaveDate 离职日期、birthDate 出生日期（都写 YYYY-MM-DD）、gender（M / F）、education（高中及以下 / 大专 / 本科 / 硕士 / 博士）、school 毕业院校、major 专业、level 职级、' +
      'employmentType（FULL_TIME 全职 / INTERN 实习 / PART_TIME 兼职 / OUTSOURCED 外包 / REHIRED 退休返聘）、tags 标签数组、' +
      'exemption 考勤 / 考核豁免（ATTENDANCE 免考勤：不进考勤统计，人员指标和成本照算；FULL 免考勤且不参与考核：如董事，考勤、人员全景指标、成本统计都不算；NONE 恢复正常）、exemptNote 豁免原因、workYears 工龄（年，推算参加工作日期）、tenureYears 司龄（年，推算入职日期）、balance:ANNUAL 年假剩余天数、balance:COMP 调休剩余天数（其他扣余额的假用 balance:<类型代码>，先用 list_leave_types 查）',
    inputSchema: obj({
      records: {
        type: 'array', description: '每人一条',
        items: { type: 'object', properties: { name: { type: 'string' }, jobNumber: { type: 'string' }, userId: { type: 'number' }, values: { type: 'object', description: '字段 → 值' } }, required: ['values'] }
      },
      year: { type: 'number', description: '余额是哪一年的，默认今年' },
      preview: { type: 'boolean', description: 'true 只看要改什么（默认），false 写入' }
    }, ['records']),
    run: async (ctx, a) => ({ ...(await importRecords(ctx, { records: a.records || [], year: a.year, preview: a.preview !== false })), url: appUrl('/import') })
  },
  {
    name: 'get_employee_profile',
    description: '看一个人的画像：档案（部门、职级、司龄、学历）、合同状态、人员成本、考勤异常、假期、1v1 情况和要留意的事。负责人能看下属，人事能看所有人，员工只能看自己。用户问「张三的情况」「他合同什么时候到期」「他今年花了公司多少钱」时用',
    inputSchema: obj({ userId: { type: 'number', description: '平台用户 id' }, name: { type: 'string', description: '姓名（不知道 id 时用）' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const p = await people.portrait(ctx, await findPerson(ctx, a))
      return {
        profile: p.profile, flags: p.flags.map(f => f.text),
        contracts: p.contracts?.map(c => ({ kind: c.kindLabel, status: c.statusLabel, startDate: c.startDate, endDate: c.endDate, daysLeft: c.daysLeft, probationEnd: c.probationEnd })),
        cost: p.cost ? { ytd: p.cost.ytd, last12Months: p.cost.last12, monthlyAvg: p.cost.monthlyAvg, byCategory: p.cost.ytdByCategory, standard: p.cost.profile } : '无权查看',
        attendanceAbnormalDays30: p.attendance.abnormalDays30, leave: p.leave, oneOnOne: p.oneOnOne,
        url: appUrl(`/people/${p.profile.id}`)
      }
    }
  },
  {
    name: 'get_people_overview',
    description: '人员全景（公司或本部门的人员蓝图）：人数、入离职、平均司龄、合同到期 / 缺失、试用期、1v1 覆盖率、状态偏低、人员成本，按部门汇总，并列出要留意的人。人事看全公司，负责人看本部门',
    inputSchema: obj({ dept: { type: 'string', description: '部门路径，只看这个部门' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const o = await people.overview(ctx, { dept: a.dept })
      return { tiles: o.tiles, byDept: o.byDept, attention: o.people.filter(p => p.flags.some(f => f.level !== 'info')).slice(0, 30).map(p => ({ name: p.employee.name, dept: p.dept, flags: p.flags.filter(f => f.level !== 'info').map(f => f.text) })), url: appUrl('/people') }
    }
  },
  {
    name: 'list_expiring_contracts',
    description: '即将到期、还没续签的劳动合同（默认按设置里的提醒天数）。人事看全公司，负责人看下属。用户问「最近谁的合同要到期」时用',
    inputSchema: obj({ withinDays: { type: 'number', description: '多少天内到期，默认按设置' } }),
    annotations: RO,
    run: async (ctx, a) => (await contracts.expiringContracts(ctx, a)).map(c => ({ name: c.employee?.name, dept: c.employee?.deptPath, endDate: c.endDate, daysLeft: c.daysLeft, number: c.number }))
  },
  {
    name: 'list_one_on_ones',
    description: '某人的 1v1 记录（日期、话题、纪要、待办、下次时间）。负责人看下属的，员工看自己的（只有本人可见的部分）。用户问「我和张三上次 1v1 聊了什么」「张三有什么待办」时用',
    inputSchema: obj({ userId: { type: 'number' }, name: { type: 'string', description: '姓名' }, limit: { type: 'number', description: '最多几条，默认 5' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const r = await oneOnOne.listFor(ctx, { userId: await findPerson(ctx, a) })
      return { employee: r.employee?.name, rows: r.rows.slice(0, Math.min(Number(a.limit) || 5, 20)).map(m => ({ date: m.date, manager: m.manager?.name, mood: m.mood, topics: m.topics, notes: m.notes, actions: m.actions.map(x => `${x.done ? '✓' : '○'} ${x.text}（${x.ownerLabel}${x.due ? `，${x.due}` : ''}）`), nextDate: m.nextDate })) }
    }
  },
  {
    name: 'log_one_on_one',
    description: '替负责人记一次 1v1：和谁、哪天、聊了什么、状态（1 ~ 5）、待办、下次时间。只能给自己的下属记（人事能给任何人记）。纪要默认本人可见，私人备注只有记录人和人事能看',
    inputSchema: obj({
      userId: { type: 'number' }, name: { type: 'string', description: '对方姓名' },
      date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
      notes: { type: 'string', description: '纪要' },
      privateNote: { type: 'string', description: '私人备注（只有自己和人事能看）' },
      mood: { type: 'number', description: '对方状态 1 很差 ~ 5 很好' },
      topics: { type: 'array', items: { type: 'string' }, description: '话题，如 工作进展、困难与支持、职业发展' },
      actions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string', enum: ['EMPLOYEE', 'MANAGER'] }, due: { type: 'string' } } }, description: '待办' },
      nextDate: { type: 'string', description: '下次 1v1 日期 YYYY-MM-DD' },
      shared: { type: 'boolean', description: '纪要和待办本人是否可见，默认 true' }
    }, ['notes']),
    run: async (ctx, a) => {
      const userId = await findPerson(ctx, a)
      const m = await oneOnOne.save(ctx, { ...a, userId, date: a.date || await contracts.today() })
      return { id: m.id, employee: m.employee?.name, date: m.date, url: appUrl(`/one-on-ones?user=${userId}`) }
    }
  },
  {
    name: 'list_pending_decisions',
    description: '等我拍板的事：快到期的劳动合同续不续签（人事）。请假在钉钉 / 飞书 / 企业微信里审批，不在这里',
    inputSchema: obj(),
    annotations: RO,
    run: async (ctx) => {
      const items = []
      // 人事：劳动合同快到期，要决定续不续签（期满前就要通知员工）
      if ((await contractScope(ctx)).all) {
        for (const c of (await contracts.expiringContracts(ctx, { withinDays: 30 })).slice(0, 10)) {
          items.push({ id: `C-${c.id}`, title: `${c.employee?.name || ''} 的劳动合同 ${c.endDate} 到期，续签还是终止？`, requester: c.employee?.name, deadline: c.endDate, url: appUrl('/contracts?status=EXPIRING') })
        }
      }
      return { items }
    }
  },
  {
    name: 'get_key_metrics',
    description: '人事考勤关键指标：今天出勤、异常、请假、出差人数，合同到期、1v1 覆盖率、人员成本（负责人看本部门，人事看全公司）',
    inputSchema: obj({ period: { type: 'string', description: 'today / week / month，考勤指标都按今天' } }),
    annotations: RO,
    run: async (ctx) => {
      const metrics = []
      if (await canSeeTeam(ctx)) {
        const t = await attendance.teamDay(ctx, {})
        if (t.workday) {
          metrics.unshift(
            { name: '今日出勤正常', value: t.stats.normal, unit: '人', note: `共 ${t.stats.total} 人`, url: appUrl('/team') },
            { name: '今日考勤异常', value: t.stats.abnormal, unit: '人', good: t.stats.abnormal === 0, url: appUrl('/team') },
            { name: '今日请假', value: t.stats.leave, unit: '人' },
            { name: '今日出差 / 外出', value: t.stats.trip + t.stats.out, unit: '人' }
          )
        }
      }
      if (await canSeeTeam(ctx)) {
        const o = await people.overview(ctx, {}).catch(() => null)
        if (o) {
          if (o.seeContracts) metrics.push({ name: '合同即将到期', value: o.tiles.contractsExpiring, unit: '人', good: o.tiles.contractsExpiring === 0, url: appUrl('/contracts?status=EXPIRING') })
          if (o.cadence) metrics.push({ name: '1v1 覆盖率', value: o.tiles.oneOnOneCoverage, unit: '%', note: `${o.cadence} 天内谈过`, good: o.tiles.oneOnOneCoverage >= 80, url: appUrl('/one-on-ones') })
          if (o.tiles.costYtd != null) metrics.push({ name: '今年人员成本', value: o.tiles.costYtd, unit: '元', note: `人均 ${o.tiles.costPerHead}`, url: appUrl('/costs') })
        }
      }
      return { metrics }
    }
  },
  {
    name: 'get_daily_summary',
    description: '人事考勤的变化与风险：昨天的考勤异常、合同快到期、新同步来的请假和出差',
    inputSchema: obj({ since: { type: 'string', description: 'ISO 时间，默认 24 小时前' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const items = []
      const since = a.since && !Number.isNaN(Date.parse(a.since)) ? new Date(a.since) : new Date(Date.now() - 86400_000)
      if (await canSeeTeam(ctx)) {
        const s = await getSettings()
        const t = await attendance.teamDay(ctx, { date: addDays(dayInTz(new Date(), s.timezone), -1) })
        const bad = t.rows.filter(r => r.status === 'ABNORMAL')
        const absent = bad.filter(r => r.flags.includes('ABSENT'))
        if (absent.length) items.push({ title: `昨天 ${absent.length} 人旷工`, detail: absent.slice(0, 10).map(r => r.employee.name).join('、'), level: 'risk', url: appUrl('/team') })
        if (bad.length > absent.length) items.push({ title: `昨天 ${bad.length - absent.length} 人考勤异常（迟到 / 早退 / 缺卡）`, level: 'warn', url: appUrl('/team') })
      }
      const scope = await visibleScope(ctx)
      const fresh = await prisma.absence.findMany({ where: { createdAt: { gte: since }, status: 'APPROVED', ...(scope.all ? {} : { userId: { in: [...scope.ids] } }) }, take: 20, orderBy: { id: 'desc' } })
      const names = new Map((await prisma.employee.findMany({ where: { id: { in: fresh.map(r => r.userId) } } })).map(e => [e.id, e.name]))
      if ((await contractScope(ctx)).all) {
        const soon = await contracts.expiringContracts(ctx, { withinDays: 14 })
        if (soon.length) items.push({ title: `${soon.length} 份劳动合同 14 天内到期`, detail: soon.slice(0, 10).map(c => `${c.employee?.name}（${c.endDate}）`).join('、'), level: 'risk', url: appUrl('/contracts?status=EXPIRING') })
      }
      const LABEL = { LEAVE: '请假', TRIP: '出差', OUT: '外出' }
      for (const r of fresh) items.push({ title: `${names.get(r.userId) || ''} ${r.typeName && r.category === 'LEAVE' ? r.typeName : LABEL[r.category]}`, detail: r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`, level: 'info', at: r.createdAt.toISOString() })
      return { items: items.slice(0, 20) }
    }
  }
]

export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    const { id, method, params } = req.body || {}
    const reply = (result) => res.json({ jsonrpc: '2.0', id, result })
    const fail = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } })
    if (id === undefined) return res.status(202).end()
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hr', version: VERSION } })
    if (method === 'ping') return reply({})
    if (method === 'tools/list') return reply({ tools: TOOLS.map(({ run, ...t }) => t) })
    if (method === 'tools/call') {
      const user = ws.enabled ? await ws.userFromToken(req.headers.authorization) : devUser()
      if (!user) return res.status(401).json({ jsonrpc: '2.0', id, error: { code: -32001, message: '未授权：需要平台签发的 access_token' } })
      const tool = TOOLS.find(t => t.name === params?.name)
      if (!tool) return fail(-32602, `没有工具 ${params?.name}`)
      await touchEmployee(user)
      const ctx = { user, via: 'AI', ip: req.ip }
      try {
        const out = await tool.run(ctx, params.arguments || {})
        ws.track(user, `mcp.${tool.name}`, { via: 'ai' })
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: Array.isArray(out) ? { items: out } : out })
      } catch (e) {
        if (!e.status) console.error('[hr] mcp', tool.name, e)
        return reply({ content: [{ type: 'text', text: e.status ? e.message : '出错了，请稍后再试' }], isError: true })
      }
    }
    return fail(-32601, `不支持 ${method}`)
  })
}
