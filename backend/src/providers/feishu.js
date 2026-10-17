// 飞书考勤：打卡结果 POST /attendance/v1/user_tasks/query（一次最多 50 人）
// 考勤接口只认 user_id（employee_id）或工号（employee_no），平台给的是 open_id：
// 先用通讯录接口把 open_id 换成 user_id（缓存在 Employee.feishuUserId），换不到的人有工号就按工号查
// 文档：https://open.feishu.cn/document/server-docs/attendance-v1/user_task/query
import { callJson, tokenCache } from './http.js'
import { platformAvailable, platformToken, resetPlatformToken } from './platformToken.js'
import { dayInTz } from '../lib/dates.js'

const API = 'https://open.feishu.cn/open-apis'
const env = () => ({ id: process.env.FEISHU_APP_ID || '', secret: process.env.FEISHU_APP_SECRET || '' })

const ownToken = tokenCache(async () => {
  const { id, secret } = env()
  const j = await callJson('飞书', `${API}/auth/v3/tenant_access_token/internal`, { method: 'POST', body: { app_id: id, app_secret: secret } })
  if (j.code !== 0) throw new Error(`飞书取 tenant_access_token 失败（${j.code}）：${j.msg}`)
  return { token: j.tenant_access_token, expiresIn: j.expire }
})
const hasOwn = () => !!(env().id && env().secret)
// 应用自己配了凭证就用自己的；没配用以虎 One 登录方式里那个飞书应用的（本来就要求同一个应用，open_id 才对得上）
const token = async () => (hasOwn() ? ownToken() : platformToken('feishu'))
token.reset = () => { ownToken.reset(); resetPlatformToken('feishu') }

async function api(path, opts = {}) {
  const j = await callJson('飞书', API + path, { ...opts, headers: { Authorization: `Bearer ${await token()}` } })
  if (j.code === 99991663 || j.code === 99991661) token.reset()
  if (j.code !== 0) throw new Error(`飞书接口出错（${j.code}）：${j.msg}`)
  return j.data || {}
}

/** open_id → user_id（≤50 个）。返回 Map(open_id -> user_id)；没权限时抛错 */
export async function resolveUserIds(openIds) {
  const q = openIds.map(id => `user_ids=${encodeURIComponent(id)}`).join('&')
  const data = await api(`/contact/v3/users/batch?user_id_type=open_id&${q}`)
  return new Map((data.items || []).filter(u => u.open_id && u.user_id).map(u => [u.open_id, u.user_id]))
}

const RESULT = { Normal: 'NORMAL', SystemCheck: 'NORMAL', Early: 'EARLY', Late: 'LATE', Lack: 'MISSING' }
const SUPPLEMENT = {
  ManagerModification: '管理员修改', CardReplacement: '补卡', CardReplacementApplication: '补卡申请', ShiftChange: '换班',
  Travel: '出差', Leave: '请假', GoOut: '外出', FieldPunch: '外勤打卡'
}
const toDay = (n) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const toDate = (sec) => (sec && Number(sec) > 0 ? new Date(Number(sec) * 1000) : null)

/** 飞书一个人一天的打卡结果 → 若干条统一形状的记录（一个班次一进一出）。未到时间（Todo）、无需打卡的不要 */
export function normalize(t, tz) {
  const out = []
  ;(t.records || []).forEach((rec, i) => {
    for (const [kind, key] of [['IN', 'check_in'], ['OUT', 'check_out']]) {
      const raw = rec[`${key}_result`]
      const result = RESULT[raw]
      if (!result) continue
      const record = rec[`${key}_record`] || {}
      const sup = SUPPLEMENT[rec[`${key}_result_supplement`]]
      out.push({
        source: 'FEISHU',
        externalId: `${t.result_id || `${t.user_id}:${t.day}`}:${i}:${kind}`,
        vendorUserId: t.user_id,
        workDate: t.day ? toDay(t.day) : dayInTz(toDate(record.check_time) || new Date(), tz),
        kind,
        checkTime: result === 'MISSING' ? null : toDate(record.check_time),
        planTime: toDate(rec[`${key}_shift_time`]),
        result,
        location: record.location_name || null,
        note: sup || null,
        raw: { result_id: t.result_id, day: t.day, record: rec, index: i }
      })
    }
  })
  return out
}

export default {
  source: 'FEISHU',
  label: '飞书',
  batchUsers: 50,
  maxDays: 7,
  configured: () => hasOwn() || platformAvailable('feishu'),
  credSource: () => (hasOwn() ? 'OWN' : platformAvailable('feishu') ? 'PLATFORM' : null),
  idOf: (emp) => emp.feishuUserId || (emp.feishuOpenId && emp.jobNumber ? `no:${emp.jobNumber}` : null),
  setupHint: '在以虎 One「管理 → 登录方式」配好飞书（人事考勤直接用那个应用的凭证），并在飞书开发者后台给它开通 attendance:task:readonly（导出打卡数据）和 contact:user.employee_id:readonly（获取用户 user ID）；也可以在 apps/hr/.env 单独配 FEISHU_APP_ID / FEISHU_APP_SECRET（必须是同一个应用）',
  hint: '员工要有飞书身份才能对上打卡：在以虎 One 里从飞书同步通讯录，或本人用飞书登录一次；拿不到 user ID 权限时按平台上的工号对',
  /**
   * ids：user_id，或 'no:<工号>'（换不到 user_id 时按工号查）
   * 返回的 vendorUserId 和传入的 id 同一种写法
   */
  async fetch(ids, from, to, tz) {
    const byId = ids.filter(x => !x.startsWith('no:'))
    const byNo = ids.filter(x => x.startsWith('no:')).map(x => x.slice(3))
    const out = []
    const d = (s) => Number(s.replaceAll('-', ''))
    for (const [type, list, prefix] of [['employee_id', byId, ''], ['employee_no', byNo, 'no:']]) {
      if (!list.length) continue
      const data = await api(`/attendance/v1/user_tasks/query?employee_type=${type}&ignore_invalid_users=true`, {
        method: 'POST', body: { user_ids: list, check_date_from: d(from), check_date_to: d(to) }
      })
      for (const t of data.user_task_results || []) {
        for (const p of normalize(t, tz)) out.push({ ...p, vendorUserId: prefix + p.vendorUserId })
      }
    }
    return out
  },
  resolveUserIds,
  _token: token
}
