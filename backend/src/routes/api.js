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
import * as absences from '../services/absences.js'
import * as importer from '../services/importer.js'
import * as profileSync from '../services/profileSync.js'
import { contractScope, costScope } from '../services/access.js'
import { VERSION } from '../lib/version.js'

const r = Router()
const id = (req) => Number(req.params.id)

r.get('/me', wrap(async (req) => {
  const ctx = req.ctx
  const info = await appInfo()
  return {
    user: { id: ctx.user.id, name: ctx.user.name, avatar: ctx.user.avatar, depts: ctx.user.depts },
    hr: await isHr(ctx), team: await canSeeTeam(ctx),
    contracts: await contractScope(ctx).then(sc => sc.all || sc.ids.size > 1), cost: await costScope(ctx).then(sc => sc.all || sc.ids.size > 0),
    oneOnOne: await canSeeTeam(ctx),
    version: VERSION,
    platform: { connected: ws.enabled, url: info?.platformUrl || null },
    brand: info?.brand || null,
    sources: PROVIDERS.filter(p => p.configured()).map(p => ({ source: p.source, label: p.label }))
  }
}))

/** 下载 CSV：出错时回 JSON（前端在新窗口打开，看得到原因） */
const csvRoute = (fn) => async (req, res) => {
  try {
    const f = await fn(req)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
    res.send(f.body)
  } catch (e) {
    res.status(e.status || 500).json({ code: e.status || 500, message: e.status ? e.message : '导出失败' })
  }
}

// 考勤
r.get('/attendance/month', wrap(req => attendance.monthOf(req.ctx, req.query)))
r.get('/attendance/records.csv', csvRoute(req => attendance.monthRecordsCsv(req.ctx, req.query)))
r.get('/attendance/team', wrap(req => attendance.teamDay(req.ctx, req.query)))
r.get('/attendance/report', wrap(req => attendance.monthlyReport(req.ctx, req.query)))
r.get('/attendance/report.csv', csvRoute(req => attendance.monthlyReportCsv(req.ctx, req.query)))
r.post('/attendance/punches', wrap(req => attendance.addManualPunch(req.ctx, req.body)))
r.delete('/attendance/punches/:id', wrap(req => attendance.deleteManualPunch(req.ctx, id(req))))

// 假期类型；请假 / 出差 / 外出（钉钉、飞书、企业微信同步来的，只读）
r.get('/leave/types', wrap(req => leave.listTypes(req.ctx, { all: req.query.all === '1' })))
r.post('/leave/types', wrap(req => leave.saveType(req.ctx, req.body)))
r.get('/absences', wrap(req => absences.absencesOf(req.ctx, req.query)))
r.get('/absences/team', wrap(req => absences.teamAbsences(req.ctx, req.query)))

// 余额
r.get('/balance/mine', wrap(req => balance.myBalance(req.ctx, req.query)))
r.get('/balance/ledger', wrap(req => balance.ledgerOf(req.ctx, req.query)))
r.get('/balance/table', wrap(req => balance.balanceTable(req.ctx, req.query)))
r.post('/balance/grant-annual', wrap(req => balance.grantAnnual(req.ctx, req.body)))
r.post('/balance/adjust', wrap(req => balance.adjust(req.ctx, req.body)))
r.post('/balance/carry-over', wrap(req => balance.carryOver(req.ctx, req.body)))

// 智能导入（档案、余额）：先识别出预览，确认后写入
r.post('/import/analyze', wrap(req => importer.analyze(req.ctx, req.body)))
r.post('/import/apply', wrap(req => importer.apply(req.ctx, req.body)))

// 员工人事字段、人事成员
r.get('/employees/search', wrap(req => balance.searchEmployees(req.ctx, req.query)))
r.patch('/employees/:id', wrap(req => balance.updateEmployee(req.ctx, id(req), req.body)))
r.get('/hr-members', wrap(req => balance.listHr(req.ctx)))
r.post('/hr-members', wrap(req => balance.addHr(req.ctx, req.body)))
r.delete('/hr-members/:id', wrap(req => balance.removeHr(req.ctx, id(req))))

// 人员：全景、画像、档案
r.get('/people/overview', wrap(req => people.overview(req.ctx, req.query)))
r.get('/people/:id', wrap(req => people.portrait(req.ctx, req.params.id)))
r.patch('/people/:id/profile', wrap(req => people.updateProfile(req.ctx, id(req), req.body)))
r.post('/people/exemption', wrap(req => people.setExemption(req.ctx, req.body)))

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
r.post('/one-on-ones/upload-token', wrap(req => oneOnOne.uploadToken(req.ctx, req.body)))
r.post('/one-on-ones/parse', wrap(req => oneOnOne.parseMinutes(req.ctx, req.body)))
r.get('/one-on-ones/:id/source', wrap(req => oneOnOne.sourceOf(req.ctx, id(req))))
r.get('/one-on-ones/:id/file', wrap(async (req, res) => res.redirect(302, await oneOnOne.sourceFileUrl(req.ctx, id(req)))))

// 设置
r.get('/settings', wrap(req => settings.listSettings(req.ctx)))
r.patch('/settings', wrap(req => settings.updateSettings(req.ctx, req.body)))
r.get('/holidays', wrap(req => holidays.listHolidays(req.ctx, req.query)))
r.post('/holidays/import', wrap(req => holidays.importHolidays(req.ctx, req.body)))
r.delete('/holidays/:date', wrap(req => holidays.deleteHoliday(req.ctx, req.params.date)))
r.get('/sync/status', wrap(req => sync.syncStatus(req.ctx)))
r.post('/sync/run', wrap(req => sync.manualSync(req.ctx, req.body)))
r.get('/sync/profiles', wrap(req => profileSync.profileSyncStatus(req.ctx)))
r.post('/sync/profiles', wrap(req => profileSync.manualSyncProfiles(req.ctx)))
r.post('/sync/profiles/resolve', wrap(req => profileSync.resolveConflicts(req.ctx, req.body)))

export default r
