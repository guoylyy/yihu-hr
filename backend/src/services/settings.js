// 应用设置：人事在「设置」里改，即改即生效。加一项 = 在 SCHEMA 里加一行（前端按它渲染）
import { prisma } from '../lib/prisma.js'
import { badRequest } from '../lib/http.js'
import { audit } from './audit.js'
import { requireHr } from './access.js'

export const SCHEMA = [
  { key: 'timezone', label: '时区', type: 'string', default: 'Asia/Shanghai', help: '按这个时区把打卡时间换成考勤日' },
  { key: 'workweek', label: '每周上班的日子', type: 'weekdays', default: [1, 2, 3, 4, 5], help: '节假日和调休上班在「节假日」里另配' },
  { key: 'syncEnabled', label: '自动同步打卡', type: 'boolean', default: true },
  { key: 'syncIntervalMinutes', label: '同步间隔（分钟）', type: 'number', default: 30, min: 10, max: 1440 },
  { key: 'syncLookbackDays', label: '每次重拉最近几天', type: 'number', default: 3, min: 1, max: 31, help: '补卡、审批、撤销请假会改动前几天的结果，所以每次都重拉最近几天' },
  { key: 'profileSync', label: '每天从钉钉 / 飞书补全档案', type: 'boolean', default: true, help: '入职日期、转正日期、出生日期、性别、学历、用工类型等：空的补上，钉钉 / 飞书上改了的跟着改，两边不一样的在「打卡同步」里让你选' },
  { key: 'dingAgentId', label: '钉钉应用的 AgentId', type: 'string', default: '', pattern: '^\\d*$', help: '填了才能读钉钉智能人事的花名册（转正、出生日期、学历、用工类型……），在钉钉开发者后台「应用信息」里看；不填只能读工号和入职日期' },
  { key: 'absenceAheadDays', label: '请假 / 出差往后多拉几天', type: 'number', default: 30, min: 0, max: 90, help: '提前请好的假、排好的出差也能在日历上看到' },
  { key: 'workStart', label: '上班时间', type: 'time', default: '09:00', help: '按小时请的假、跨天的出差按和上下班时段的重叠折算到每天' },
  { key: 'workEnd', label: '下班时间', type: 'time', default: '18:00' },
  { key: 'hoursPerDay', label: '一天按几小时算', type: 'number', default: 8, min: 1, max: 12, help: '按小时请的假折成天' },
  { key: 'annualRounding', label: '年假折算取整', type: 'select', default: 'floor', options: [{ value: 'floor', label: '不足 1 天不给（法定）' }, { value: 'half', label: '精确到半天' }] },
  { key: 'annualExtraDays', label: '公司福利年假（天/年）', type: 'number', default: 0, min: 0, max: 30, help: '在法定年假之外每年多给的天数，按同样方式折算' },
  { key: 'carryOverMaxDays', label: '年假最多结转几天到下一年', type: 'number', default: 0, min: 0, max: 30 },
  { key: 'contractWarnDays', label: '合同到期前几天提醒', type: 'number', default: 60, min: 7, max: 180, help: '劳动合同期满前要和员工确认续签与否；人员全景、画像、AI 助手的简报都按这个提醒' },
  { key: 'leaderSeeContracts', label: '部门负责人能看下属的合同', type: 'boolean', default: true, help: '只能看，不能改；合同由人事管' },
  { key: 'leaderSeeCost', label: '部门负责人能看下属的人员成本', type: 'boolean', default: true, help: '工资、社保、奖金等都算在内。关掉后只有人事能看' },
  { key: 'oneOnOneCadenceDays', label: '1v1 建议间隔（天）', type: 'number', default: 30, min: 0, max: 180, help: '超过这么多天没有 1v1 会在人员全景里标出来；0 = 不提醒' }
]

let cache = null
export async function getSettings() {
  if (cache && cache.until > Date.now()) return cache.value
  const rows = await prisma.setting.findMany()
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const value = Object.fromEntries(SCHEMA.map(f => [f.key, saved[f.key] ?? f.default]))
  cache = { value, until: Date.now() + 10_000 }
  return value
}

function check(f, v) {
  switch (f.type) {
    case 'boolean': if (typeof v !== 'boolean') throw badRequest(`${f.label} 要是开 / 关`); return v
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n) || n < (f.min ?? -Infinity) || n > (f.max ?? Infinity)) throw badRequest(`${f.label} 要在 ${f.min} ~ ${f.max} 之间`)
      return n
    }
    case 'time': if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw badRequest(`${f.label} 写 HH:mm`); return v
    case 'select': if (!f.options.some(o => o.value === v)) throw badRequest(`${f.label} 的取值不对`); return v
    case 'weekdays':
      if (!Array.isArray(v) || !v.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw badRequest(`${f.label} 的取值不对`)
      return [...new Set(v)].sort()
    default: {
      const s = String(v ?? '').trim()
      if (f.pattern && !new RegExp(f.pattern).test(s)) throw badRequest(`${f.label} 的格式不对`)
      if (f.key === 'timezone') {
        try { new Intl.DateTimeFormat('en', { timeZone: s }) } catch { throw badRequest(`不认识的时区：${s}`) }
      }
      return s
    }
  }
}

export async function listSettings(ctx) {
  await requireHr(ctx)
  return { schema: SCHEMA, values: await getSettings() }
}

export async function updateSettings(ctx, patch = {}) {
  await requireHr(ctx)
  const current = await getSettings()
  const next = {}
  for (const [k, v] of Object.entries(patch)) {
    const f = SCHEMA.find(x => x.key === k)
    if (!f) throw badRequest(`没有设置项 ${k}`)
    next[k] = check(f, v)
  }
  const merged = { ...current, ...next }
  if (merged.workEnd <= merged.workStart) throw badRequest('下班时间要晚于上班时间')
  const changed = {}
  for (const [k, value] of Object.entries(next)) {
    if (JSON.stringify(value) === JSON.stringify(current[k])) continue
    await prisma.setting.upsert({ where: { key: k }, create: { key: k, value, updatedBy: ctx.user.id }, update: { value, updatedBy: ctx.user.id } })
    changed[k] = value
  }
  cache = null
  if (Object.keys(changed).length) audit(ctx, 'settings.update', { entityType: 'setting', detail: changed })
  return getSettings()
}
