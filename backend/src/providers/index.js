// 打卡来源。加一家 = 写一个同样形状的适配器加进来：
//   { source, label, batchUsers, maxDays, configured(), idOf(employee), hint, fetch(ids, from, to, tz) → 统一形状的打卡记录[] }
// 请假 / 出差 / 外出（可选）：{ absenceBatchUsers, absenceMaxDays, fetchAbsences(ids, from, to, tz) → 统一形状的假勤记录[] }
//   假勤记录：{ source, externalId, vendorUserId, category: LEAVE | TRIP | OUT, typeName, startAt, endAt, startDate, endDate, days, hours, approvalId, raw }
import dingtalk from './dingtalk.js'
import feishu from './feishu.js'
import wecom from './wecom.js'

export const PROVIDERS = [dingtalk, feishu, wecom]
export const providerOf = (source) => PROVIDERS.find(p => p.source === source)
export const SOURCE_LABEL = { DINGTALK: '钉钉', FEISHU: '飞书', WECOM: '企业微信', MANUAL: '手工补录', DIRECTORY: '通讯录' }
