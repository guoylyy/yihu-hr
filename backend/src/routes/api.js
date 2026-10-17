// 接口：路由保持薄，权限和业务在 services 里
import { Router } from 'express'
import { wrap } from '../lib/http.js'
import { appInfo, ws } from '../lib/platform.js'
import { PROVIDERS } from '../providers/index.js'
import { canSeeTeam, isHr } from '../services/access.js'
import * as attendance from '../services/attendance.js'
import * as leave from '../services/leave.js'
import * as balance from '../services/balance.js'
import * as holidays from '../services/holidays.js'
import * as settings from '../services/settings.js'
import * as sync from '../services/sync.js'
import * as contracts from '../services/contracts.js'
import * as cost from '../services/cost.js'
import * as people from '../services/people.js'
import * as oneOnOne from '../services/oneOnOne.js'
import { contractScope, costScope } from '../services/access.js'

const r = Router()
const id = (req) => Number(req.params.id)

r.get('/me', wrap(async (req) => {
  const ctx = req.ctx
  const info = await appInfo()
  return {
    user: { id: ctx.user.id, name: ctx.user.name, avatar: ctx.user.avatar, depts: ctx.user.depts },
    hr: await isHr(ctx), team: await canSeeTeam(ctx),
    contracts: await contractScope(ctx).then(sc => sc.all || sc.ids.size > 1), cost: await costScope(ctx).then(sc => sc.all || sc.ids.size > 0),
    oneOnOne: await canSeeTeam(ctx), approver: (await leave.pendingForMe(ctx)).length > 0 || !!ctx.user.leaderOf?.length || await isHr(ctx),
    platform: { connected: ws.enabled, url: info?.platformUrl || null },
    brand: info?.brand || null,
    sources: PROVIDERS.filter(p => p.configured()).map(p => ({ source: p.source, label: p.label }))
  }
}))

// 考勤
r.get('/attendance/month', wrap(req => attendance.monthOf(req.ctx, req.query)))
r.get('/attendance/team', wrap(req => attendance.teamDay(req.ctx, req.query)))
r.get('/attendance/report', wrap(req => attendance.monthlyReport(req.ctx, req.query)))
r.get('/attendance/report.csv', async (req, res) => {
  try {
    const f = await attendance.monthlyReportCsv(req.ctx, req.query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
    res.send(f.body)
  } catch (e) {
    res.status(e.status || 500).json({ code: e.status || 500, message: e.status ? e.message : '导出失败' })
  }
})
r.post('/attendance/punches', wrap(req => attendance.addManualPunch(req.ctx, req.body)))
r.delete('/attendance/punches/:id', wrap(req => attendance.deleteManualPunch(req.ctx, id(req))))

// 请假
r.get('/leave/types', wrap(req => leave.listTypes(req.ctx, { all: req.query.all === '1' })))
r.post('/leave/types', wrap(req => leave.saveType(req.ctx, req.body)))
r.get('/leave/estimate', wrap(req => leave.estimate(req.ctx, req.query)))
r.get('/leave/mine', wrap(req => leave.myRequests(req.ctx, req.query)))
r.get('/leave/pending', wrap(req => leave.pendingForMe(req.ctx)))
r.get('/leave/team', wrap(req => leave.teamRequests(req.ctx, req.query)))
r.get('/leave/:id', wrap(req => leave.getRequest(req.ctx, id(req))))
r.post('/leave', wrap(req => leave.submitLeave(req.ctx, req.body)))
r.post('/leave/:id/decide', wrap(req => leave.decideLeave(req.ctx, id(req), req.body)))
r.post('/leave/:id/cancel', wrap(req => leave.cancelLeave(req.ctx, id(req), req.body)))

// 余额
r.get('/balance/mine', wrap(req => balance.myBalance(req.ctx, req.query)))
r.get('/balance/ledger', wrap(req => balance.ledgerOf(req.ctx, req.query)))
r.get('/balance/table', wrap(req => balance.balanceTable(req.ctx, req.query)))
r.post('/balance/grant-annual', wrap(req => balance.grantAnnual(req.ctx, req.body)))
r.post('/balance/adjust', wrap(req => balance.adjust(req.ctx, req.body)))
r.post('/balance/carry-over', wrap(req => balance.carryOver(req.ctx, req.body)))

// 员工人事字段、人事成员
r.get('/employees/search', wrap(req => balance.searchEmployees(req.ctx, req.query)))
r.patch('/employees/:id', wrap(req => balance.updateEmployee(req.ctx, id(req), req.body)))
r.post('/employees/import-dates', wrap(req => balance.importEmployeeDates(req.ctx, req.body)))
r.get('/hr-members', wrap(req => balance.listHr(req.ctx)))
r.post('/hr-members', wrap(req => balance.addHr(req.ctx, req.body)))
r.delete('/hr-members/:id', wrap(req => balance.removeHr(req.ctx, id(req))))

// 人员：全景、画像、档案
r.get('/people/overview', wrap(req => people.overview(req.ctx, req.query)))
r.get('/people/:id', wrap(req => people.portrait(req.ctx, req.params.id)))
r.patch('/people/:id/profile', wrap(req => people.updateProfile(req.ctx, id(req), req.body)))

// 合同
r.get('/contracts', wrap(req => contracts.listContracts(req.ctx, req.query)))
r.post('/contracts', wrap(req => contracts.saveContract(req.ctx, req.body)))
r.post('/contracts/upload-token', wrap(req => contracts.uploadToken(req.ctx, req.body)))
r.get('/contracts/:id', wrap(req => contracts.getContract(req.ctx, id(req))))
r.get('/contracts/:id/file', wrap(async (req, res) => res.redirect(302, await contracts.fileUrl(req.ctx, id(req)))))
r.post('/contracts/:id/terminate', wrap(req => contracts.terminateContract(req.ctx, id(req), req.body)))
r.delete('/contracts/:id', wrap(req => contracts.removeContract(req.ctx, id(req))))

// 人员成本
r.get('/cost/table', wrap(req => cost.costTable(req.ctx, req.query)))
r.get('/cost/summary', wrap(req => cost.costSummary(req.ctx, req.query)))
r.post('/cost/item', wrap(req => cost.setItem(req.ctx, req.body)))
r.put('/cost/profile/:id', wrap(req => cost.setProfile(req.ctx, id(req), req.body)))
r.post('/cost/generate', wrap(req => cost.generate(req.ctx, req.body)))
r.post('/cost/import', wrap(req => cost.importItems(req.ctx, req.body)))

// 1v1
r.get('/one-on-ones/roster', wrap(req => oneOnOne.roster(req.ctx, req.query)))
r.get('/one-on-ones', wrap(req => oneOnOne.listFor(req.ctx, req.query)))
r.post('/one-on-ones', wrap(req => oneOnOne.save(req.ctx, req.body)))
r.delete('/one-on-ones/:id', wrap(req => oneOnOne.remove(req.ctx, id(req))))
r.post('/one-on-ones/:id/action', wrap(req => oneOnOne.toggleAction(req.ctx, id(req), req.body)))

// 设置
r.get('/settings', wrap(req => settings.listSettings(req.ctx)))
r.patch('/settings', wrap(req => settings.updateSettings(req.ctx, req.body)))
r.get('/holidays', wrap(req => holidays.listHolidays(req.ctx, req.query)))
r.post('/holidays/import', wrap(req => holidays.importHolidays(req.ctx, req.body)))
r.delete('/holidays/:date', wrap(req => holidays.deleteHoliday(req.ctx, req.params.date)))
r.get('/sync/status', wrap(req => sync.syncStatus(req.ctx)))
r.post('/sync/run', wrap(req => sync.manualSync(req.ctx, req.body)))

export default r
