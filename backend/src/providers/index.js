// 打卡来源。加一家 = 写一个同样形状的适配器加进来：
//   { source, label, batchUsers, maxDays, configured(), idOf(employee), hint, fetch(ids, from, to, tz) → 统一形状的记录[] }
import dingtalk from './dingtalk.js'
import feishu from './feishu.js'
import wecom from './wecom.js'

export const PROVIDERS = [dingtalk, feishu, wecom]
export const providerOf = (source) => PROVIDERS.find(p => p.source === source)
export const SOURCE_LABEL = { DINGTALK: '钉钉', FEISHU: '飞书', WECOM: '企业微信', MANUAL: '手工补录', DIRECTORY: '通讯录' }
