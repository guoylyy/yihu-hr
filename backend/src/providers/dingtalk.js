// 钉钉考勤：打卡结果 POST /attendance/list（一次最多 50 人、7 天，分页 50 条）
// 文档：https://open.dingtalk.com/document/orgapp/open-attendance-clock-in-data
import { callJson, tokenCache } from './http.js'
import { dayInTz } from '../lib/dates.js'

const API = 'https://oapi.dingtalk.com'
const env = () => ({ key: process.env.DINGTALK_APP_KEY || '', secret: process.env.DINGTALK_APP_SECRET || '' })

const token = tokenCache(async () => {
  const { key, secret } = env()
  const j = await callJson('钉钉', `${API}/gettoken?appkey=${encodeURIComponent(key)}&appsecret=${encodeURIComponent(secret)}`)
  if (j.errcode !== 0) throw new Error(`钉钉取 access_token 失败（${j.errcode}）：${j.errmsg}`)
  return { token: j.access_token, expiresIn: j.expires_in }
})

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

export default {
  source: 'DINGTALK',
  label: '钉钉',
  batchUsers: 50,
  maxDays: 7,
  configured: () => !!(env().key && env().secret),
  idOf: (emp) => emp.dingUserId || null,
  hint: '在「管理 → 登录方式」配钉钉并「从钉钉同步」通讯录，员工才有钉钉身份',
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
  _token: token
}
