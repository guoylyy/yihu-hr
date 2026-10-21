import test from 'node:test'
import assert from 'node:assert/strict'
import { fromDingRoster, fromDingUser, fromFeishuUser, mergeProfile } from '../src/lib/vendorProfile.js'

const TZ = 'Asia/Shanghai'

test('钉钉通讯录、花名册、飞书 → 档案字段', () => {
  assert.deepEqual(fromDingUser({ job_number: 'E0052', hired_date: Date.parse('2021-03-01T00:00:00+08:00') }, TZ), { jobNumber: 'E0052', hireDate: '2021-03-01' })
  assert.deepEqual(fromDingUser({ job_number: '', hired_date: 0 }, TZ), {})
  const f = (code, value, label) => ({ field_code: code, field_value_list: [{ value, label }] })
  assert.deepEqual(fromDingRoster({ userid: 'u1', field_data_list: [
    f('sys00-confirmJoinTime', '2021-03-01'), f('sys02-birthTime', '1990-05-12'), f('sys02-sexType', '1', '女'), f('sys03-highestEdu', '6', '本科'),
    f('sys01-employeeType', '1', '全职'), f('sys01-regularTime', '2021-06-01'), f('sys03-major', '会计学'), f('sys00-name', '张三'), f('sys03-graduateSchool', '')
  ] }), { hireDate: '2021-03-01', birthDate: '1990-05-12', gender: 'F', education: '本科', employmentType: 'FULL_TIME', regularDate: '2021-06-01', major: '会计学' })
  assert.deepEqual(fromFeishuUser({ employee_no: 'F01', join_time: Date.parse('2022-07-04T00:00:00+08:00') / 1000, gender: 1, employee_type: 2 }, TZ), { jobNumber: 'F01', hireDate: '2022-07-04', gender: 'M', employmentType: 'INTERN' })
})

test('三方比对：补空、钉钉上改了就更新、这里改过就保留、第一次不一样记冲突', () => {
  const app = { hireDate: '2021-03-01', gender: null, education: '硕士', level: 'P5' }
  // 第一次：空的补，不一样的是冲突
  let r = mergeProfile(app, null, { hireDate: '2021-03-01', gender: 'F', education: '本科' })
  assert.deepEqual(r.set, { gender: 'F' })
  assert.deepEqual(r.conflicts, [{ field: 'education', app: '硕士', vendor: '本科' }])
  // 钉钉上把入职日期改了 → 更新
  r = mergeProfile(app, { hireDate: '2021-03-01', education: '本科' }, { hireDate: '2021-04-01', education: '本科' })
  assert.deepEqual(r.set, { hireDate: '2021-04-01' })
  assert.deepEqual(r.updated, ['hireDate'])
  // 钉钉没改、这里改成了硕士 → 保留这里的
  assert.deepEqual(mergeProfile(app, { education: '本科' }, { education: '本科' }), { set: {}, conflicts: [], updated: [] })
  // 后来才读到的字段（上次快照里没有）按第一次比
  assert.deepEqual(mergeProfile(app, { hireDate: '2021-03-01' }, { level: 'P6' }).conflicts, [{ field: 'level', app: 'P5', vendor: 'P6' }])
  // 钉钉上没填：不清掉这里的
  assert.deepEqual(mergeProfile(app, { level: 'P5' }, {}).set, {})
})
