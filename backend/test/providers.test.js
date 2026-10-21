import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import dingtalk, { normalize as ding, normalizeLeave as dingLeave } from '../src/providers/dingtalk.js'
import feishu, { normalize as fs, normalizeApprovals as fsApprovals } from '../src/providers/feishu.js'
import wecom, { normalize as wc, normalizeDay as wcDay } from '../src/providers/wecom.js'

const TZ = 'Asia/Shanghai'
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** 按地址前缀返回假的响应，记下调用 */
function stub(routes) {
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k))
    if (!hit) throw new Error(`没有桩：${url}`)
    const body = typeof hit[1] === 'function' ? hit[1](calls[calls.length - 1]) : hit[1]
    return new Response(JSON.stringify(body), { status: 200 })
  }
  return calls
}

test('钉钉：结果映射，缺卡没有打卡时间，地点异常', () => {
  const base = { id: 1, userId: 'u1', workDate: Date.parse('2026-10-12T00:00:00+08:00'), checkType: 'OnDuty', baseCheckTime: Date.parse('2026-10-12T09:00:00+08:00'), userCheckTime: Date.parse('2026-10-12T09:12:00+08:00'), sourceType: 'ATM' }
  const late = ding({ ...base, timeResult: 'Late', locationResult: 'Normal' }, TZ)
  assert.equal(late.workDate, '2026-10-12')
  assert.equal(late.result, 'LATE')
  assert.equal(late.kind, 'IN')
  assert.equal(ding({ ...base, timeResult: 'NotSigned', checkType: 'OffDuty' }, TZ).checkTime, null)
  assert.equal(ding({ ...base, timeResult: 'Normal', locationResult: 'Outside' }, TZ).result, 'LOCATION')
})

test('钉钉：取 token、分页拉取', async () => {
  process.env.DINGTALK_APP_KEY = 'k'; process.env.DINGTALK_APP_SECRET = 's'
  dingtalk._token.reset()
  const row = (id) => ({ id, userId: 'u1', workDate: Date.parse('2026-10-12T00:00:00+08:00'), checkType: 'OnDuty', timeResult: 'Normal', userCheckTime: 1 })
  const calls = stub({
    '/gettoken': { errcode: 0, access_token: 'T', expires_in: 7200 },
    '/attendance/list': (c) => c.body.offset === 0 ? { errcode: 0, recordresult: [row(1)], hasMore: true } : { errcode: 0, recordresult: [row(2)], hasMore: false }
  })
  const out = await dingtalk.fetch(['u1'], '2026-10-12', '2026-10-12', TZ)
  assert.deepEqual(out.map(x => x.externalId), ['1', '2'])
  const list = calls.filter(c => c.url.includes('/attendance/list'))
  assert.equal(list[0].body.workDateFrom, '2026-10-12 00:00:00')
  assert.ok(list[0].url.includes('access_token=T'))
})

test('钉钉：接口出错带上错误信息', async () => {
  process.env.DINGTALK_APP_KEY = 'k'; process.env.DINGTALK_APP_SECRET = 's'
  dingtalk._token.reset()
  stub({ '/gettoken': { errcode: 0, access_token: 'T', expires_in: 7200 }, '/attendance/list': { errcode: 60011, errmsg: '没有调用该接口的权限' } })
  await assert.rejects(() => dingtalk.fetch(['u1'], '2026-10-12', '2026-10-12', TZ), /60011.*没有调用该接口的权限/)
})

test('飞书：一个班次拆成上班、下班两条；Todo 不要', () => {
  const t = {
    result_id: 'R1', user_id: 'fu1', day: 20261012,
    records: [{
      check_in_record: { check_time: String(Date.parse('2026-10-12T08:58:00+08:00') / 1000), location_name: '总部' }, check_in_result: 'Normal', check_in_shift_time: String(Date.parse('2026-10-12T09:00:00+08:00') / 1000),
      check_out_record: {}, check_out_result: 'Todo'
    }, { check_in_result: 'Lack', check_in_record: {}, check_out_result: 'Early', check_out_record: { check_time: String(Date.parse('2026-10-12T17:00:00+08:00') / 1000) }, check_out_result_supplement: 'CardReplacement' }]
  }
  const out = fs(t, TZ)
  assert.deepEqual(out.map(x => [x.externalId, x.kind, x.result]), [['R1:0:IN', 'IN', 'NORMAL'], ['R1:1:IN', 'IN', 'MISSING'], ['R1:1:OUT', 'OUT', 'EARLY']])
  assert.equal(out[0].workDate, '2026-10-12')
  assert.equal(out[0].location, '总部')
  assert.equal(out[1].checkTime, null)
  assert.equal(out[2].note, '补卡')
})

test('飞书：有 user_id 的按 employee_id 查，其余按工号查', async () => {
  process.env.FEISHU_APP_ID = 'a'; process.env.FEISHU_APP_SECRET = 'b'
  feishu._token.reset()
  const calls = stub({
    '/tenant_access_token/internal': { code: 0, tenant_access_token: 'T', expire: 7200 },
    'employee_type=employee_id': { code: 0, data: { user_task_results: [{ result_id: 'A', user_id: 'fu1', day: 20261012, records: [{ check_in_result: 'Normal', check_in_record: { check_time: '1760230000' } }] }] } },
    'employee_type=employee_no': { code: 0, data: { user_task_results: [{ result_id: 'B', user_id: 'E001', day: 20261012, records: [{ check_in_result: 'Late', check_in_record: { check_time: '1760231000' } }] }] } }
  })
  const out = await feishu.fetch(['fu1', 'no:E001'], '2026-10-12', '2026-10-13', TZ)
  assert.deepEqual(out.map(x => x.vendorUserId), ['fu1', 'no:E001'])
  const q = calls.find(c => c.url.includes('employee_id'))
  assert.deepEqual(q.body, { user_ids: ['fu1'], check_date_from: 20261012, check_date_to: 20261013 })
})

test('飞书：idOf 优先 user_id，否则有工号按工号', () => {
  assert.equal(feishu.idOf({ feishuUserId: 'x' }), 'x')
  assert.equal(feishu.idOf({ feishuOpenId: 'ou_1', jobNumber: 'E1' }), 'no:E1')
  assert.equal(feishu.idOf({ feishuOpenId: 'ou_1' }), null)
  assert.equal(feishu.idOf({ jobNumber: 'E1' }), null) // 没登过飞书的人不按工号乱对
})

test('企业微信：异常类型映射', () => {
  const r = { userid: 'w1', checkin_type: '上班打卡', exception_type: '时间异常', checkin_time: Date.parse('2026-10-12T09:20:00+08:00') / 1000, sch_checkin_time: Date.parse('2026-10-12T09:00:00+08:00') / 1000, location_title: '园区' }
  assert.equal(wc(r, TZ).result, 'LATE')
  assert.equal(wc({ ...r, checkin_type: '下班打卡' }, TZ).result, 'EARLY')
  const miss = wc({ ...r, exception_type: '未打卡' }, TZ)
  assert.equal(miss.result, 'MISSING')
  assert.equal(miss.checkTime, null)
  assert.equal(wc({ ...r, exception_type: '' }, TZ).result, 'NORMAL')
  assert.equal(wc({ ...r, checkin_type: '外出打卡', exception_type: '' }, TZ).kind, 'OUTSIDE')
  assert.equal(wc(r, TZ).externalId, `w1:IN:${r.sch_checkin_time}`)
})

test('企业微信：时间范围按时区换成秒', async () => {
  process.env.WECOM_CORP_ID = 'c'; process.env.WECOM_CHECKIN_SECRET = 's'
  wecom._token.reset()
  const calls = stub({ '/gettoken': { errcode: 0, access_token: 'T', expires_in: 7200 }, '/checkin/getcheckindata': { errcode: 0, checkindata: [] } })
  await wecom.fetch(['w1'], '2026-10-12', '2026-10-12', TZ)
  const b = calls.find(c => c.url.includes('getcheckindata')).body
  assert.equal(b.starttime, Date.parse('2026-10-12T00:00:00+08:00') / 1000)
  assert.equal(b.endtime, Date.parse('2026-10-13T00:00:00+08:00') / 1000 - 1)
  assert.deepEqual(b.useridlist, ['w1'])
})

test('钉钉：本应用没配凭证时用以虎 One 登录方式里那个应用的 token，失效了换新的', async () => {
  const { ws } = await import('../src/lib/platform.js')
  const { refreshPlatformChannels } = await import('../src/providers/platformToken.js')
  delete process.env.DINGTALK_APP_KEY; delete process.env.DINGTALK_APP_SECRET
  dingtalk._token.reset()
  const enabled = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ws), 'enabled')
  Object.defineProperty(ws, 'enabled', { get: () => true, configurable: true })
  let n = 0
  ws.channelToken = async (p) => { n++; assert.equal(p, 'dingtalk'); return { accessToken: `P${n}`, expiresAt: new Date(Date.now() + 7200_000).toISOString() } }
  try {
    await refreshPlatformChannels()
    assert.equal(dingtalk.configured(), true)
    assert.equal(dingtalk.credSource(), 'PLATFORM')
    // 第一次 token 被钉钉判过期（42001）：丢掉，下次用新的
    let first = true
    const calls = stub({ '/attendance/list': (c) => (first && !(first = false) ? { errcode: 42001, errmsg: 'access_token expired' } : { errcode: 0, recordresult: [], hasMore: false }) })
    await assert.rejects(dingtalk.fetch(['u1'], '2026-10-12', '2026-10-12', TZ), /42001/)
    await dingtalk.fetch(['u1'], '2026-10-12', '2026-10-12', TZ)
    assert.ok(calls[0].url.includes('access_token=P'))
    assert.ok(!calls.some(c => c.url.includes('/gettoken')), '不该自己去换 token')
    assert.notEqual(calls[0].url.match(/access_token=(\w+)/)[1], calls[1].url.match(/access_token=(\w+)/)[1])
    // 平台没配钉钉：未配置，带上平台的说明
    ws.channelToken = async () => { throw new Error('钉钉未配置：请管理员在「管理 → 登录方式」填写') }
    dingtalk._token.reset()
    await refreshPlatformChannels()
    assert.equal(dingtalk.configured(), false)
    assert.equal(dingtalk.credSource(), null)
  } finally {
    delete ws.channelToken
    delete ws.enabled
    if (enabled) Object.defineProperty(Object.getPrototypeOf(ws), 'enabled', enabled)
  }
})

// ---------- 请假 / 出差 / 外出 ----------

test('钉钉请假：按天 / 按小时的时长，结束在 0 点的算到前一天', () => {
  const day = dingLeave({ userid: 'u1', start_time: Date.parse('2026-10-15T00:00:00+08:00'), end_time: Date.parse('2026-10-17T00:00:00+08:00'), duration_unit: 'percent_day', duration_percent: 200 }, TZ)
  assert.equal(day.category, 'LEAVE')
  assert.equal(day.startDate, '2026-10-15')
  assert.equal(day.endDate, '2026-10-16')
  assert.equal(day.days, 2)
  assert.equal(day.hours, null)
  const hour = dingLeave({ userid: 'u1', start_time: Date.parse('2026-10-15T14:00:00+08:00'), end_time: Date.parse('2026-10-15T16:00:00+08:00'), duration_unit: 'percent_hour', duration_percent: 200 }, TZ)
  assert.equal(hour.hours, 2)
  assert.equal(hour.externalId, `u1:${Date.parse('2026-10-15T14:00:00+08:00')}:${Date.parse('2026-10-15T16:00:00+08:00')}`)
})

test('钉钉请假：一次 100 人、分页 20 条，时间按时区换成毫秒', async () => {
  process.env.DINGTALK_APP_KEY = 'k'; process.env.DINGTALK_APP_SECRET = 's'
  dingtalk._token.reset()
  const leave = (n) => ({ userid: 'u1', start_time: n, end_time: n + 3600_000, duration_unit: 'percent_hour', duration_percent: 100 })
  const calls = stub({
    '/gettoken': { errcode: 0, access_token: 'T', expires_in: 7200 },
    '/getleavestatus': (c) => (c.body.offset === 0 ? { errcode: 0, result: { has_more: true, leave_status: [leave(1)] } } : { errcode: 0, result: { has_more: false, leave_status: [leave(2)] } })
  })
  const out = await dingtalk.fetchAbsences(['u1', 'u2'], '2026-10-15', '2026-10-16', TZ)
  assert.equal(out.length, 2)
  const q = calls.filter(c => c.url.includes('/getleavestatus'))
  assert.equal(q[0].body.userid_list, 'u1,u2')
  assert.equal(q[0].body.size, 20)
  assert.equal(q[0].body.start_time, Date.parse('2026-10-15T00:00:00+08:00'))
  assert.equal(q[0].body.end_time, Date.parse('2026-10-17T00:00:00+08:00') - 1)
  assert.equal(q[1].body.offset, 20)
})

test('飞书审批：请假、出差、外出，按审批去重；按小时的带时长；不存事由', async () => {
  const ua = {
    user_id: 'fu1', date: 20261015,
    leaves: [{ uniq_id: 'L1', approval_id: 'A1', unit: 1, interval: 28800, start_time: '2026-10-15 09:00:00', end_time: '2026-10-16 18:00:00', i18n_names: { ch: '年假' }, reason: '回老家' }],
    trips: [{ approval_id: 'T1', start_time: '2026-10-19 09:00:00', end_time: '2026-10-20 18:00:00' }],
    outs: [{ uniq_id: 'O1', approval_id: 'A3', unit: 2, interval: 7200, start_time: '2026-10-21 14:00:00', end_time: '2026-10-21 16:00:00', i18n_names: { ch: '外出' } }]
  }
  const list = fsApprovals(ua, TZ)
  assert.deepEqual(list.map(x => [x.category, x.typeName, x.startDate, x.endDate, x.hours]), [['LEAVE', '年假', '2026-10-15', '2026-10-16', null], ['TRIP', '出差', '2026-10-19', '2026-10-20', null], ['OUT', '外出', '2026-10-21', '2026-10-21', 2]])
  assert.equal(list[0].startAt.toISOString(), '2026-10-15T01:00:00.000Z')
  assert.equal(list[0].raw.reason, undefined)

  process.env.FEISHU_APP_ID = 'a'; process.env.FEISHU_APP_SECRET = 'b'
  feishu._token.reset()
  const calls = stub({
    '/tenant_access_token': { code: 0, tenant_access_token: 'T', expire: 7200 },
    // 跨两天的假两天各给一次
    '/user_approvals/query': { code: 0, data: { user_approvals: [ua, { ...ua, date: 20261016, trips: [], outs: [] }] } }
  })
  const out = await feishu.fetchAbsences(['fu1'], '2026-10-15', '2026-10-21', TZ)
  assert.equal(out.length, 3)
  const q = calls.find(c => c.url.includes('/user_approvals/query'))
  assert.deepEqual(q.body, { user_ids: ['fu1'], check_date_from: 20261015, check_date_to: 20261021, status: 2 })
  assert.ok(q.url.includes('employee_type=employee_id'))
})

test('企业微信日报：只要请假、出差、外出，时长按天 / 按小时', () => {
  const d = {
    base_info: { date: Date.parse('2026-10-15T00:00:00+08:00') / 1000, acctid: 'w1' },
    sp_items: [
      { type: 1, vacation_id: 7, count: 1, duration: 43200, time_type: 0, name: '年假' },
      { type: 1, vacation_id: 8, count: 1, duration: 7200, time_type: 1, name: '事假' },
      { type: 2, count: 1, duration: 0, time_type: 0, name: '补卡次数' },
      { type: 3, count: 1, duration: 86400, time_type: 0, name: '出差' },
      { type: 4, count: 0, duration: 0, time_type: 1, name: '外出' }
    ]
  }
  const list = wcDay(d, TZ)
  assert.deepEqual(list.map(x => [x.category, x.typeName, x.startDate, x.days, x.hours]), [['LEAVE', '年假', '2026-10-15', 0.5, null], ['LEAVE', '事假', '2026-10-15', null, 2], ['TRIP', '出差', '2026-10-15', 1, null]])
  assert.equal(list[0].externalId, 'w1:2026-10-15:1:7')
})
