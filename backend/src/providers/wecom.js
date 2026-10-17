// 企业微信打卡：POST /cgi-bin/checkin/getcheckindata（一次最多 100 人、30 天）
// 要用「打卡」系统应用的 Secret 取 token（和平台登录用的自建应用不是一个）
// 文档：https://developer.work.weixin.qq.com/document/path/90262
import { callJson, tokenCache } from './http.js'
import { dayInTz, zonedTime, addDays } from '../lib/dates.js'

const API = 'https://qyapi.weixin.qq.com/cgi-bin'
const env = () => ({ corp: process.env.WECOM_CORP_ID || '', secret: process.env.WECOM_CHECKIN_SECRET || '' })

const token = tokenCache(async () => {
  const { corp, secret } = env()
  const j = await callJson('企业微信', `${API}/gettoken?corpid=${encodeURIComponent(corp)}&corpsecret=${encodeURIComponent(secret)}`)
  if (j.errcode !== 0) throw new Error(`企业微信取 access_token 失败（${j.errcode}）：${j.errmsg}`)
  return { token: j.access_token, expiresIn: j.expires_in }
})

const KIND = { 上班打卡: 'IN', 下班打卡: 'OUT', 外出打卡: 'OUTSIDE' }

/** 企业微信一条打卡 → 统一形状 */
export function normalize(r, tz) {
  const kind = KIND[r.checkin_type] || 'OTHER'
  const ex = String(r.exception_type || '')
  let result = 'NORMAL'
  if (ex.includes('未打卡')) result = 'MISSING'
  else if (ex.includes('时间异常')) result = kind === 'OUT' ? 'EARLY' : 'LATE'
  else if (ex.includes('地点异常') || ex.includes('wifi异常')) result = 'LOCATION'
  else if (ex) result = 'OTHER'
  const at = r.checkin_time ? new Date(r.checkin_time * 1000) : null
  const plan = r.sch_checkin_time ? new Date(r.sch_checkin_time * 1000) : null
  return {
    source: 'WECOM',
    externalId: `${r.userid}:${kind}:${r.sch_checkin_time || r.checkin_time}`,
    vendorUserId: r.userid,
    workDate: dayInTz(plan || at || new Date(), tz),
    kind: kind === 'OTHER' ? 'OUTSIDE' : kind,
    checkTime: result === 'MISSING' ? null : at,
    planTime: plan,
    result,
    location: r.location_title || null,
    note: ex && result === 'OTHER' ? ex : (r.notes || null),
    raw: r
  }
}

export default {
  source: 'WECOM',
  label: '企业微信',
  batchUsers: 100,
  maxDays: 30,
  configured: () => !!(env().corp && env().secret),
  credSource: () => (env().corp && env().secret ? 'OWN' : null),
  idOf: (emp) => emp.wecomUserId || null,
  setupHint: '企业微信打卡要用「应用管理 → 打卡」这个系统应用的 Secret（和平台登录用的自建应用不是一个），管理员写进 apps/hr/.env 的 WECOM_CORP_ID / WECOM_CHECKIN_SECRET，并把打卡的 API 可见范围设为全员，改完重启应用',
  hint: '员工要有企业微信身份才能对上打卡：在以虎 One「管理 → 登录方式」里同步企业微信通讯录，或本人用企业微信登录一次',
  async fetch(ids, from, to, tz) {
    const start = Math.floor(zonedTime(from, '00:00', tz).getTime() / 1000)
    const end = Math.floor(zonedTime(addDays(to, 1), '00:00', tz).getTime() / 1000) - 1
    const j = await callJson('企业微信', `${API}/checkin/getcheckindata?access_token=${await token()}`, {
      method: 'POST', body: { opencheckindatatype: 3, starttime: start, endtime: end, useridlist: ids }
    })
    if (j.errcode === 40014 || j.errcode === 42001) token.reset()
    if (j.errcode !== 0) throw new Error(`企业微信打卡接口出错（${j.errcode}）：${j.errmsg}`)
    return (j.checkindata || []).map(r => normalize(r, tz))
  },
  _token: token
}
