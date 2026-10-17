import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import dingtalk, { normalize as ding } from '../src/providers/dingtalk.js'
import feishu, { normalize as fs } from '../src/providers/feishu.js'
import wecom, { normalize as wc } from '../src/providers/wecom.js'

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
