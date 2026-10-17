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
import { myBalance } from './services/balance.js'
import { getSettings } from './services/settings.js'

const RO = { readOnlyHint: true }
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required })

const TOOLS = [
  {
    name: 'get_my_attendance',
    description: '查我（或我能看的同事）某个月的考勤：每天的上下班打卡时间、迟到早退缺卡、请假。用户问「我这个月考勤」「我有没有迟到」「上个月缺卡几次」时用',
    inputSchema: obj({ month: { type: 'string', description: '月份 YYYY-MM，默认本月' }, userId: { type: 'number', description: '同事的平台用户 id，默认本人' } }),
    annotations: RO,
    run: async (ctx, a) => {
      const r = await attendance.monthOf(ctx, a)
      return { employee: r.employee, month: r.month, summary: r.summary, abnormalDays: r.days.filter(d => d.status === 'ABNORMAL').map(d => ({ date: d.date, flags: d.flags, firstIn: d.firstIn, lastOut: d.lastOut })) }
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
    name: 'get_my_leave_balance',
    description: '查我的假期余额（年假、调休）：总余额、待审批占用、可用天数。用户问「我还有几天年假」时用',
    inputSchema: obj({ year: { type: 'number', description: '年份，默认今年' } }),
    annotations: RO,
    run: (ctx, a) => myBalance(ctx, a)
  },
  {
    name: 'list_my_leave_requests',
    description: '列出我的请假记录和审批状态',
    inputSchema: obj({ year: { type: 'number', description: '年份，不填列最近的' } }),
    annotations: RO,
    run: async (ctx, a) => (await leave.myRequests(ctx, a)).slice(0, 30).map(r => ({ id: r.id, type: r.typeCode, startDate: r.startDate, startHalf: r.startHalf, endDate: r.endDate, endHalf: r.endHalf, days: r.days, status: r.statusLabel, approver: r.approver?.name }))
  },
  {
    name: 'list_leave_types',
    description: '列出能请的假期类型（代码和名称），提交请假前用来确定 typeCode',
    inputSchema: obj(),
    annotations: RO,
    run: async (ctx) => (await leave.listTypes(ctx)).map(t => ({ code: t.code, name: t.name, unit: t.unit === 'DAY' ? '按整天' : '可请半天', needsBalance: t.balanced }))
  },
  {
    name: 'submit_leave_request',
    description: '替我提交请假申请。日期要换算成 YYYY-MM-DD；半天假用 startHalf / endHalf（AM 上午、PM 下午）；typeCode 先用 list_leave_types 查。提交后发给审批人',
    inputSchema: obj({
      typeCode: { type: 'string', description: '假期类型代码，如 ANNUAL 年假、PERSONAL 事假、SICK 病假' },
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
      startHalf: { type: 'string', enum: ['AM', 'PM'], description: '从上午（AM，默认）还是下午（PM）开始' },
      endDate: { type: 'string', description: '结束日期 YYYY-MM-DD，默认同开始日期' },
      endHalf: { type: 'string', enum: ['AM', 'PM'], description: '到上午（AM）还是下午（PM，默认）结束' },
      reason: { type: 'string', description: '事由' }
    }, ['typeCode', 'startDate']),
    run: async (ctx, a) => {
      const r = await leave.submitLeave(ctx, a)
      return { id: r.id, days: r.days, status: r.statusLabel, approver: r.approver?.name || '人事', url: appUrl('/leave') }
    }
  },
  {
    name: 'decide_leave_request',
    description: '审批一条请假（批准或驳回）。只能审批指派给我的；人事可以审批任何一条。先用 list_pending_decisions 找到 id',
    inputSchema: obj({ id: { type: 'number', description: '请假 id' }, approve: { type: 'boolean', description: 'true 批准，false 驳回' }, note: { type: 'string', description: '审批意见' } }, ['id', 'approve']),
    run: async (ctx, a) => {
      const r = await leave.decideLeave(ctx, a.id, a)
      return { id: r.id, status: r.statusLabel, employee: r.employee?.name }
    }
  },
  {
    name: 'list_pending_decisions',
    description: '等我审批的请假申请',
    inputSchema: obj(),
    annotations: RO,
    run: async (ctx) => {
      const names = new Map((await leave.listTypes(ctx, { all: true })).map(t => [t.code, t.name]))
      return {
        items: (await leave.pendingForMe(ctx)).slice(0, 20).map(r => ({
          id: `L-${r.id}`, title: `${r.employee?.name || ''} ${names.get(r.typeCode) || '请假'} ${r.days} 天（${r.startDate} ~ ${r.endDate}）`,
          requester: r.employee?.name, deadline: r.startDate, url: appUrl('/approvals')
        }))
      }
    }
  },
  {
    name: 'get_key_metrics',
    description: '人事考勤关键指标：今天出勤、异常、请假人数，待审批请假数（负责人看本部门，人事看全公司）',
    inputSchema: obj({ period: { type: 'string', description: 'today / week / month，考勤指标都按今天' } }),
    annotations: RO,
    run: async (ctx) => {
      const pending = (await leave.pendingForMe(ctx)).length
      const metrics = [{ name: '待我审批的请假', value: pending, unit: '条', good: pending === 0, url: appUrl('/approvals') }]
      if (await canSeeTeam(ctx)) {
        const t = await attendance.teamDay(ctx, {})
        if (t.workday) {
          metrics.unshift(
            { name: '今日出勤正常', value: t.stats.normal, unit: '人', note: `共 ${t.stats.total} 人`, url: appUrl('/team') },
            { name: '今日考勤异常', value: t.stats.abnormal, unit: '人', good: t.stats.abnormal === 0, url: appUrl('/team') },
            { name: '今日请假', value: t.stats.leave, unit: '人' }
          )
        }
      }
      return { metrics }
    }
  },
  {
    name: 'get_daily_summary',
    description: '人事考勤的变化与风险：昨天的考勤异常、新提交的请假',
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
      const fresh = await prisma.leaveRequest.findMany({ where: { createdAt: { gte: since }, ...(scope.all ? {} : { userId: { in: [...scope.ids] } }) }, take: 20, orderBy: { id: 'desc' } })
      const names = new Map((await prisma.employee.findMany({ where: { id: { in: fresh.map(r => r.userId) } } })).map(e => [e.id, e.name]))
      for (const r of fresh) items.push({ title: `${names.get(r.userId) || ''} 提交请假 ${Number(r.days)} 天`, detail: `${r.startDate} ~ ${r.endDate}，${leave.STATUS_LABEL[r.status]}`, level: 'info', at: r.createdAt.toISOString() })
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
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hr', version: '0.1.0' } })
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
