export const STATUS = {
  NORMAL: { label: '正常', type: 'success' },
  ABNORMAL: { label: '异常', type: 'danger' },
  LEAVE: { label: '请假', type: 'primary' },
  REST: { label: '休息', type: 'info' },
  NO_DATA: { label: '无记录', type: 'warning' }
}
export const FLAG = { LATE: '迟到', SERIOUS_LATE: '严重迟到', EARLY: '早退', MISSING: '缺卡', ABSENT: '旷工', LOCATION: '地点异常', OTHER: '其他', NORMAL: '正常' }
export const KIND = { IN: '上班', OUT: '下班', OUTSIDE: '外出' }
export const HALF = { AM: '上午', PM: '下午' }
export const LEAVE_STATUS = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'info' }
export const LEDGER_KIND = { GRANT: '发放', CARRY_OVER: '上年结转', ADJUST: '调整', USE: '请假扣减', RESTORE: '撤销退回', EXPIRE: '清零' }
export const WEEK = ['日', '一', '二', '三', '四', '五', '六']
export const weekdayOf = (d) => WEEK[new Date(d + 'T00:00:00Z').getUTCDay()]
export const flagsText = (flags) => (flags || []).map(f => FLAG[f] || f).join('、')

const pad = (n) => String(n).padStart(2, '0')
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const thisMonth = () => today().slice(0, 7)
export const thisYear = () => Number(today().slice(0, 4))
export const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '')
export const range = (r) => `${r.startDate}${r.startHalf === 'PM' ? ' 下午' : ''} ~ ${r.endDate}${r.endHalf === 'AM' ? ' 上午' : ''}`

// ---------- 人员、合同、成本、1v1 ----------
export const CONTRACT_KINDS = { LABOR: '劳动合同', CONFIDENTIALITY: '保密协议', NON_COMPETE: '竞业限制协议', IP: '知识产权归属协议', TRAINING: '培训服务期协议', INTERN: '实习协议', SERVICE: '劳务协议', OTHER: '其他' }
export const CONTRACT_TERMS = { FIXED: '固定期限', OPEN: '无固定期限', TASK: '以完成一定工作任务为期限' }
export const CONTRACT_STATUS = { ACTIVE: 'success', EXPIRING: 'warning', EXPIRED: 'danger', TERMINATED: 'info', PENDING: 'info', SIGNED: 'info', IN_FORCE: 'warning' }
export const COST_CATEGORIES = { SALARY: '工资', BONUS: '奖金', SOCIAL: '社保（单位）', HOUSING: '公积金（单位）', BENEFIT: '福利', TRAINING: '培训', EQUIPMENT: '设备办公', RECRUIT: '招聘', NON_COMPETE: '竞业补偿', SEVERANCE: '经济补偿', OTHER: '其他' }
export const EMPLOYMENT = { FULL_TIME: '全职', INTERN: '实习', PART_TIME: '兼职', OUTSOURCED: '外包', REHIRED: '退休返聘' }
export const EDUCATION = ['高中及以下', '大专', '本科', '硕士', '博士']
export const TOPICS = ['工作进展', '目标与优先级', '困难与支持', '反馈', '成长与学习', '职业发展', '团队协作', '状态与生活']
export const MOODS = { 1: '很差', 2: '偏低', 3: '一般', 4: '不错', 5: '很好' }
export const FLAG_LEVEL = { risk: 'danger', warn: 'warning', info: 'info' }
export const PEOPLE_FLAGS = { ANY: '需要留意（风险 / 提醒）', NO_LABOR: '没有有效劳动合同', LABOR_EXPIRING: '劳动合同即将到期', PROBATION_ENDING: '试用期快结束', NO_CONFIDENTIALITY: '没有保密协议', NO_1V1: '太久没有 1v1', LOW_MOOD: '状态偏低', OPEN_ACTIONS: '1v1 待办未完成', ATTENDANCE: '考勤异常多', LEFT: '已离职（含竞业限制）' }
export const yuan = (v) => (v == null ? '—' : '¥' + Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
export const wan = (v) => (v == null ? '—' : Math.abs(v) >= 10000 ? `${Math.round(v / 1000) / 10} 万` : Number(v).toLocaleString('zh-CN'))
