// 从钉钉 / 飞书补全档案的纯逻辑（单元测试覆盖）：各家的字段 → 本应用的档案字段，和三方比对。
// 三方比对：V = 钉钉 / 飞书现在的值，S = 上次读到的值（vendorSnapshot），A = 这里现在的值
//   V 为空            → 不动（钉钉上没填不代表要清掉这里的）
//   V == A            → 不动
//   A 为空            → 补上 V
//   有 S 且 V != S    → 钉钉 / 飞书上改了 → 更新成 V
//   有 S 且 V == S    → 钉钉 / 飞书没改、是这里改过 → 保留这里的
//   没有 S（第一次比） → 两边不一样：记成冲突，等人事选
// 工号只补空的，不覆盖、不报冲突（平台上的工号为准，services/profileSync.js 里先去掉）
import { parseDate, parseEducation, parseEmployment, parseGender } from './importer.js'

/** 能从钉钉 / 飞书补的字段（工号只在平台没给时补，见 services/directory.js） */
export const PROFILE_SYNC_FIELDS = {
  jobNumber: '工号', hireDate: '入职日期', regularDate: '转正日期', workStartDate: '参加工作日期', birthDate: '出生日期',
  gender: '性别', education: '学历', school: '毕业院校', major: '专业', employmentType: '用工类型', level: '职级'
}

const ymdOfMs = (ms, tz = 'Asia/Shanghai') => {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(n))
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''))
const text = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

/** 钉钉通讯录用户详情（topapi/v2/user/get）：只有工号、入职时间 */
export function fromDingUser(u, tz) {
  return clean({ jobNumber: text(u.job_number, 50), hireDate: ymdOfMs(u.hired_date, tz) })
}

/**
 * 钉钉智能人事花名册（topapi/smartwork/hrm/employee/v2/list）的一个人：field_data_list → 档案字段。
 * 下拉类的字段用 label（「男」「本科」「全职」），日期用 value
 */
export const DING_ROSTER_FIELDS = {
  'sys00-jobNumber': 'jobNumber', 'sys00-confirmJoinTime': 'hireDate', 'sys01-regularTime': 'regularDate', 'sys02-joinWorkingTime': 'workStartDate',
  'sys02-birthTime': 'birthDate', 'sys02-sexType': 'gender', 'sys03-highestEdu': 'education', 'sys03-graduateSchool': 'school', 'sys03-major': 'major',
  'sys01-employeeType': 'employmentType', 'sys01-positionLevel': 'level'
}
export function fromDingRoster(item) {
  const raw = {}
  for (const f of item.field_data_list || item.field_list || []) {
    const key = DING_ROSTER_FIELDS[f.field_code]
    if (!key) continue
    const v = (f.field_value_list || [])[0] || {}
    raw[key] = v.label || v.value || null
  }
  return normalizeFields(raw)
}

// 飞书 employee_type：1 正式、2 实习、3 外包、4 劳务、5 顾问
const FEISHU_TYPE = { 1: 'FULL_TIME', 2: 'INTERN', 3: 'OUTSOURCED', 4: 'OUTSOURCED' }
/** 飞书通讯录用户（contact/v3/users/batch）：工号、入职时间、性别、人员类型 */
export function fromFeishuUser(u, tz) {
  return clean({
    jobNumber: text(u.employee_no, 50),
    hireDate: u.join_time ? ymdOfMs(Number(u.join_time) * 1000, tz) : null,
    gender: u.gender === 1 ? 'M' : u.gender === 2 ? 'F' : null,
    employmentType: FEISHU_TYPE[u.employee_type] || null
  })
}

/** 各家写法 → 本应用的格式；认不出的丢掉（不写错数据） */
export function normalizeFields(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || String(v).trim() === '') continue
    if (['hireDate', 'regularDate', 'workStartDate', 'birthDate'].includes(k)) out[k] = /^\d{12,}$/.test(String(v)) ? ymdOfMs(v) : parseDate(v)
    else if (k === 'gender') out[k] = parseGender(v)
    else if (k === 'education') out[k] = parseEducation(v)
    else if (k === 'employmentType') out[k] = parseEmployment(v)
    else out[k] = text(v, k === 'level' ? 20 : k === 'jobNumber' ? 50 : 100)
  }
  return clean(out)
}

/**
 * 三方比对。app：这里现在的值；snap：上次读到的（没有就是第一次）；vendor：现在读到的。
 * 返回 { set: { 字段: 新值 }, conflicts: [{ field, app, vendor }], updated: [字段]（钉钉 / 飞书上改了的）}
 */
export function mergeProfile(app, snap, vendor) {
  const set = {}, conflicts = [], updated = []
  for (const [k, v] of Object.entries(vendor)) {
    if (!(k in PROFILE_SYNC_FIELDS) || v == null) continue
    const a = app[k] ?? null
    if (a === v) continue
    if (a == null) { set[k] = v; continue }
    // 上次也读到过这个字段才能判断是谁改的；没读到过（比如后来才配好花名册权限）按第一次比
    if (snap && k in snap) {
      if (snap[k] !== v) { set[k] = v; updated.push(k) }
      continue
    }
    conflicts.push({ field: k, app: a, vendor: v })
  }
  return { set, conflicts, updated }
}
