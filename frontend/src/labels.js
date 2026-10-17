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
