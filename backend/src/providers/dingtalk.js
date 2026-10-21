// 钉钉考勤：打卡结果 POST /attendance/list（一次最多 50 人、7 天，分页 50 条）
// 请假：POST /topapi/attendance/getleavestatus（一次最多 100 人，分页 20 条）—— 只给请假时段和时长，不给假期类型
// 出差、外出、请假类型：钉钉没有批量接口，只有逐人逐天的 POST /topapi/attendance/getupdatedata（审批单 approve_list）。
//   为了省调用量，只查「打卡记录上挂了审批实例（procInstId）、以前没查过」的那几天，和还不知道类型的请假的第一天；
//   一次同步最多查 DING_DETAIL_MAX 次，没查完的下次接着查（查过的由调用方记在 SyncSeen）
// 文档：https://open.dingtalk.com/document/orgapp/open-attendance-clock-in-data
//       https://open.dingtalk.com/document/orgapp/query-status-of-leave
//       https://open.dingtalk.com/document/orgapp/obtain-the-attendance-update-data
import { callJson, tokenCache } from './http.js'
import { platformAvailable, platformToken, resetPlatformToken } from './platformToken.js'
import { addDays, chunk, dayInTz, zonedTime } from '../lib/dates.js'
import { DING_ROSTER_FIELDS, fromDingRoster, fromDingUser } from '../lib/vendorProfile.js'

const API = 'https://oapi.dingtalk.com'
const env = () => ({ key: process.env.DINGTALK_APP_KEY || '', secret: process.env.DINGTALK_APP_SECRET || '' })

const ownToken = tokenCache(async () => {
  const { key, secret } = env()
  const j = await callJson('钉钉', `${API}/gettoken?appkey=${encodeURIComponent(key)}&appsecret=${encodeURIComponent(secret)}`)
  if (j.errcode !== 0) throw new Error(`钉钉取 access_token 失败（${j.errcode}）：${j.errmsg}`)
  return { token: j.access_token, expiresIn: j.expires_in }
})
const hasOwn = () => !!(env().key && env().secret)
// 应用自己配了凭证就用自己的；没配用以虎 One 登录方式里那个钉钉应用的
const token = async () => (hasOwn() ? ownToken() : platformToken('dingtalk'))
token.reset = () => { ownToken.reset(); resetPlatformToken('dingtalk') }

const TIME_RESULT = { Normal: 'NORMAL', Early: 'EARLY', Late: 'LATE', SeriousLate: 'SERIOUS_LATE', Absenteeism: 'ABSENT', NotSigned: 'MISSING' }

/** 钉钉一条打卡结果 → 统一形状（userId 由调用方补） */
export function normalize(r, tz) {
  let result = TIME_RESULT[r.timeResult] || 'OTHER'
  if (result === 'NORMAL' && r.locationResult === 'Outside') result = 'LOCATION'
  const signed = r.timeResult !== 'NotSigned' && r.userCheckTime
  return {
    source: 'DINGTALK',
    externalId: String(r.id),
    vendorUserId: r.userId,
    workDate: dayInTz(new Date(Number(r.workDate)), tz),
    kind: r.checkType === 'OffDuty' ? 'OUT' : 'IN',
    checkTime: signed ? new Date(Number(r.userCheckTime)) : null,
    planTime: r.baseCheckTime ? new Date(Number(r.baseCheckTime)) : null,
    result,
    location: null,
    note: r.sourceType && r.sourceType !== 'ATM' && r.sourceType !== 'DING_ATM' ? `来源：${r.sourceType}` : null,
    raw: r
  }
}

const DETAIL_MAX = Number(process.env.DING_DETAIL_MAX) || 150
const TAG = { 请假: 'LEAVE', 出差: 'TRIP', 外出: 'OUT' }
const parseTime = (t, tz) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(t || ''))
  return m ? zonedTime(m[1], m[2], tz) : null
}

/**
 * getupdatedata 的审批单 → { trips: 出差 / 外出的统一记录, leaveTypes: [{ start, end, typeName }] }
 * 请假本身已经由 getleavestatus 拉到（带时长），这里只拿它的类型去补
 */
export function normalizeApproveList(userid, list, tz) {
  const trips = [], leaveTypes = []
  for (const a of list || []) {
    const category = TAG[a.tag_name] || (Number(a.biz_type) === 3 ? 'LEAVE' : null)
    const startAt = parseTime(a.begin_time, tz), endAt = parseTime(a.end_time, tz)
    if (!category || !startAt || !endAt) continue
    if (category === 'LEAVE') { if (a.sub_type) leaveTypes.push({ start: startAt.getTime(), end: endAt.getTime(), typeName: a.sub_type }); continue }
    const n = Number(a.duration)
    const unit = String(a.duration_unit || '').toUpperCase()
    trips.push({
      source: 'DINGTALK',
      externalId: `appr:${a.procInst_id || `${userid}:${startAt.getTime()}`}`,
      vendorUserId: userid,
      category,
      typeName: category === 'TRIP' ? '出差' : a.sub_type || '外出',
      startAt, endAt,
      startDate: dayInTz(startAt, tz),
      endDate: dayInTz(new Date(Math.max(startAt.getTime(), endAt.getTime() - 1)), tz),
      days: n > 0 && unit.includes('DAY') ? (unit.includes('HALF') ? n / 2 : n) : null,
      hours: n > 0 && unit.includes('HOUR') ? n : null,
      approvalId: a.procInst_id || null,
      raw: { ...a }
    })
  }
  return { trips, leaveTypes }
}

/** 钉钉一条请假状态 → 统一形状的假勤记录 */
export function normalizeLeave(r, tz) {
  const start = new Date(Number(r.start_time))
  const end = new Date(Number(r.end_time))
  const n = Number(r.duration_percent) / 100
  return {
    source: 'DINGTALK',
    externalId: `${r.userid}:${r.start_time}:${r.end_time}`,
    vendorUserId: r.userid,
    category: 'LEAVE',
    typeName: r.leave_name || null,
    startAt: start, endAt: end,
    startDate: dayInTz(start, tz),
    // 结束在 0 点的（整天假常见）算到前一天
    endDate: dayInTz(new Date(Math.max(start.getTime(), end.getTime() - 1)), tz),
    days: r.duration_unit === 'percent_day' && n > 0 ? n : null,
    hours: r.duration_unit === 'percent_hour' && n > 0 ? n : null,
    approvalId: null,
    raw: r
  }
}

export default {
  source: 'DINGTALK',
  label: '钉钉',
  batchUsers: 50,
  maxDays: 7,
  configured: () => hasOwn() || platformAvailable('dingtalk'),
  /** 凭证从哪来：OWN 本应用 .env / PLATFORM 以虎 One 登录方式里的钉钉应用 */
  credSource: () => (hasOwn() ? 'OWN' : platformAvailable('dingtalk') ? 'PLATFORM' : null),
  idOf: (emp) => emp.dingUserId || null,
  setupHint: '在以虎 One「管理 → 登录方式」配好钉钉（人事考勤直接用那个应用的凭证），并在钉钉开发者后台给它开通考勤「打卡结果」读权限；也可以在 apps/hr/.env 单独配 DINGTALK_APP_KEY / DINGTALK_APP_SECRET',
  hint: '员工要有钉钉身份才能对上打卡：在以虎 One「管理 → 登录方式」里「从钉钉同步」通讯录，或本人用钉钉登录一次',
  /** ids：钉钉 userId（≤50），from/to：YYYY-MM-DD（≤7 天） */
  async fetch(ids, from, to, tz) {
    const out = []
    for (let offset = 0; ; offset += 50) {
      const j = await callJson('钉钉', `${API}/attendance/list?access_token=${await token()}`, {
        method: 'POST',
        body: { workDateFrom: `${from} 00:00:00`, workDateTo: `${to} 00:00:00`, userIdList: ids, offset, limit: 50, isI18n: false }
      })
      if (j.errcode === 40014 || j.errcode === 42001) token.reset()
      if (j.errcode !== 0) throw new Error(`钉钉考勤接口出错（${j.errcode}）：${j.errmsg}`)
      for (const r of j.recordresult || []) out.push(normalize(r, tz))
      if (!j.hasMore || offset > 5000) break
    }
    return out
  },
  absenceCovers: '请假（时段、时长；类型逐条补查）、出差、外出（按打卡记录上挂的审批逐条补查）',
  absenceHint: '要在钉钉开发者后台给这个应用开通考勤的「查询请假状态」和「获取考勤更新数据」（getupdatedata）接口权限',
  absenceBatchUsers: 100,
  absenceMaxDays: 30,
  /**
   * 请假（批量）+ 出差、外出、请假类型（按需逐天补查）。ids：钉钉 userId（≤100）
   * opts.hints：[{ userid, day, key }] 打卡记录上挂了审批的日子（key = 审批实例 id）
   * opts.known(key)：查过的不再查；返回的 checked 是这次查过的 key，调用方记下来
   */
  async fetchAbsences(ids, from, to, tz, { hints = [], known = () => false } = {}) {
    const out = []
    const start = zonedTime(from, '00:00', tz).getTime()
    const end = zonedTime(addDays(to, 1), '00:00', tz).getTime() - 1
    for (let offset = 0; ; offset += 20) {
      const j = await callJson('钉钉', `${API}/topapi/attendance/getleavestatus?access_token=${await token()}`, {
        method: 'POST', body: { userid_list: ids.join(','), start_time: start, end_time: end, offset, size: 20 }
      })
      if (j.errcode === 40014 || j.errcode === 42001) token.reset()
      if (j.errcode !== 0) throw new Error(`钉钉请假接口出错（${j.errcode}）：${j.errmsg}`)
      for (const r of j.result?.leave_status || []) out.push(normalizeLeave(r, tz))
      if (!j.result?.has_more || offset > 5000) break
    }
    // 逐天补查：挂了审批的打卡日 + 还不知道类型的请假的第一天
    const mine = new Set(ids)
    const todo = new Map()
    const want = (userid, day, key) => todo.set(`${userid}|${day}`, (todo.get(`${userid}|${day}`) || new Set()).add(key))
    for (const h of hints) if (mine.has(h.userid) && h.day >= from && h.day <= to && !known(h.key)) want(h.userid, h.day, h.key)
    for (const l of out) if (!l.typeName && !known(l.externalId)) want(l.vendorUserId, l.startDate, l.externalId)
    const checked = []
    const trips = new Map()
    let calls = 0
    for (const [k, keys] of todo) {
      if (calls++ >= DETAIL_MAX) break
      const [userid, day] = k.split('|')
      const j = await callJson('钉钉', `${API}/topapi/attendance/getupdatedata?access_token=${await token()}`, { method: 'POST', body: { userid, work_date: `${day} 00:00:00` } })
      if (j.errcode === 40014 || j.errcode === 42001) token.reset()
      if (j.errcode !== 0) throw new Error(`钉钉考勤详情接口出错（${j.errcode}）：${j.errmsg}`)
      const r = normalizeApproveList(userid, j.result?.approve_list, tz)
      for (const t of r.trips) trips.set(t.externalId, t)
      for (const lt of r.leaveTypes) {
        const hit = out.find(l => l.vendorUserId === userid && Math.abs(l.startAt.getTime() - lt.start) < 120_000 && Math.abs(l.endAt.getTime() - lt.end) < 120_000)
        if (hit) hit.typeName = lt.typeName
      }
      checked.push(...keys)
    }
    const list = [...out, ...trips.values()]
    list.checked = checked
    list.pending = Math.max(0, todo.size - DETAIL_MAX)
    return list
  },
  /**
   * 档案（补全用）：Map(钉钉 userId -> 档案字段)。
   * 配了 AgentId（设置里）读智能人事花名册（一次 100 人，字段全）；没配读通讯录详情（一人一次，只有工号、入职时间，最多 maxBasic 人）
   */
  async fetchProfiles(ids, { agentId, tz, maxBasic = 300 } = {}) {
    const out = new Map()
    if (agentId) {
      for (const part of chunk(ids, 100)) {
        const j = await callJson('钉钉', `${API}/topapi/smartwork/hrm/employee/v2/list?access_token=${await token()}`, {
          method: 'POST', body: { userid_list: part.join(','), field_filter_list: Object.keys(DING_ROSTER_FIELDS).join(','), agentid: Number(agentId) }
        })
        if (j.errcode === 40014 || j.errcode === 42001) token.reset()
        if (j.errcode !== 0) throw new Error(`钉钉智能人事花名册接口出错（${j.errcode}）：${j.errmsg}`)
        for (const item of j.result || []) out.set(item.userid, fromDingRoster(item))
      }
      return out
    }
    for (const userid of ids.slice(0, maxBasic)) {
      const j = await callJson('钉钉', `${API}/topapi/v2/user/get?access_token=${await token()}`, { method: 'POST', body: { userid } })
      if (j.errcode === 40014 || j.errcode === 42001) token.reset()
      if (j.errcode === 60121) continue // 找不到这个人（已经离开钉钉组织）
      if (j.errcode !== 0) throw new Error(`钉钉通讯录接口出错（${j.errcode}）：${j.errmsg}`)
      out.set(userid, fromDingUser(j.result || {}, tz))
    }
    out.skipped = Math.max(0, ids.length - maxBasic)
    return out
  },
  profileIdOf: (emp) => emp.dingUserId || null,
  profileHint: '读钉钉通讯录要开通「成员信息读权限」；在「设置 → 规则」填上钉钉应用的 AgentId 并开通「智能人事花名册」读权限，能读到转正日期、出生日期、性别、学历、用工类型等',
  /** 打卡记录上挂了审批实例的（出差、外出、请假时钉钉会挂上）→ 逐天补查的线索 */
  approvalHint: (p) => (p.raw?.procInstId ? { userid: p.vendorUserId, day: p.workDate, key: `proc:${p.raw.procInstId}` } : null),
  _token: token
}
