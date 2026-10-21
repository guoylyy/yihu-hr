// 考勤 / 考核豁免（纯函数，单元测试覆盖）。一个人可以：
//   ATTENDANCE 免考勤 —— 不进考勤统计（团队矩阵、出勤率、今日出勤、考勤异常标记），人员全景的指标、人员成本照算
//   FULL       免考勤、不参与考核 —— 再加上不进人员全景的指标（人数、司龄、1v1 覆盖、风险……）和人员成本的统计，
//              也不提醒 1v1、状态、待办、没有劳动合同 / 保密协议（如董事，本来就不一定有）
// 被豁免的人在名单、档案、成本表里照常能看到，只是不算进统计
export const EXEMPTIONS = { ATTENDANCE: '免考勤', FULL: '免考勤、不参与考核' }
/** 短标签（名单里的小标签） */
export const EXEMPTION_TAG = { ATTENDANCE: '免考勤', FULL: '不参与考核' }

export const attendanceExempt = (e) => e?.exemption === 'ATTENDANCE' || e?.exemption === 'FULL'
export const evaluationExempt = (e) => e?.exemption === 'FULL'

/** 不参与考核时不提醒的标记（考核类、以及董事这类本来就不一定有的合同） */
export const FULL_SKIP_FLAGS = ['NO_LABOR', 'NO_CONFIDENTIALITY', 'PROBATION_ENDING', 'NO_1V1', 'LOW_MOOD', 'OPEN_ACTIONS', 'ATTENDANCE']

/** 各种写法 → ATTENDANCE / FULL / NONE（正常，清掉豁免）；认不出返回 null */
export function parseExemption(v) {
  const t = String(v ?? '').trim()
  if (!t) return null
  const up = t.toUpperCase()
  if (up === 'ATTENDANCE' || up === 'FULL' || up === 'NONE') return up
  if (/不参与考核|免考核|不考核|董事|监事|顾问|全部豁免|都免/.test(t)) return 'FULL'
  if (/免考勤|不考勤|免打卡|不打卡/.test(t)) return 'ATTENDANCE'
  if (/^(正常|否|无|不免|要考勤|考勤|需要|no|n)$/i.test(t)) return 'NONE'
  return null
}
