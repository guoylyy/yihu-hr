// 1v1 会议纪要的纯逻辑（单元测试覆盖）：各种文件 → 纯文本、模型给的解析结果的校验、没有模型时的规则兜底
//   支持：.txt .md（原样）、.srt .vtt（去掉序号和时间轴，合并同一个人连续说的话）、.docx（mammoth）、.pdf（unpdf）
//   飞书妙记、钉钉闪记、腾讯会议导出的纪要 / 文字稿都是这几种
import { isDateStr } from './dates.js'

export const MAX_TEXT = 200_000
export const FILE_EXT = ['txt', 'md', 'srt', 'vtt', 'docx', 'pdf']
export const extOf = (name) => String(name || '').toLowerCase().split('.').pop()

/** 字幕（srt / vtt）→ 「说话人：内容」一行一句 */
export function fromSubtitles(text) {
  const out = []
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l && l !== 'WEBVTT' && !/^\d+$/.test(l) && !/-->/.test(l) && !/^(NOTE|STYLE)\b/.test(l))
    if (!lines.length) continue
    const line = lines.join(' ').replace(/<v ([^>]+)>/g, '$1：').replace(/<[^>]+>/g, '')
    const m = /^([^：:]{1,20})[：:]\s*(.*)$/.exec(line)
    const last = out[out.length - 1]
    if (m && last && last.who === m[1]) last.text += ' ' + m[2]
    else out.push(m ? { who: m[1], text: m[2] } : { who: null, text: line })
  }
  return out.map(x => (x.who ? `${x.who}：${x.text}` : x.text)).join('\n')
}

/** 文件内容 → 纯文本。buf：Buffer */
export async function extractText(buf, fileName) {
  const ext = extOf(fileName)
  let text
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default
    text = (await mammoth.extractRawText({ buffer: buf })).value
  } else if (ext === 'pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    text = (await pdfText(pdf, { mergePages: true })).text
  } else if (ext === 'srt' || ext === 'vtt') {
    text = fromSubtitles(buf.toString('utf8'))
  } else if (ext === 'txt' || ext === 'md') {
    text = buf.toString('utf8').replace(/^﻿/, '')
  } else {
    throw Object.assign(new Error(`不支持 .${ext} 文件：请导出成 ${FILE_EXT.join(' / ')}`), { status: 400 })
  }
  return cleanText(text)
}

export const cleanText = (t) => String(t || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT)

/**
 * 模型给的结果 → 能直接填进 1v1 表单的草稿（不合规的丢掉）。
 * topics 只留预设的话题；owner 只有 EMPLOYEE / MANAGER；日期要 YYYY-MM-DD；状态 1 ~ 5
 */
export function sanitizeParsed(j, { topics }) {
  const date = (v) => (isDateStr(v) ? v : null)
  const str = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
  const mood = Number(j.mood)
  return {
    date: date(j.date),
    minutes: Number.isFinite(Number(j.minutes)) && Number(j.minutes) > 0 ? Math.min(600, Math.round(Number(j.minutes))) : null,
    topics: (Array.isArray(j.topics) ? j.topics : []).map(String).filter(t => topics.includes(t)).slice(0, 8),
    summary: str(Array.isArray(j.summary) ? j.summary.map(x => `- ${x}`).join('\n') : j.summary, 20000),
    actions: (Array.isArray(j.actions) ? j.actions : []).map(a => ({ text: str(a?.text, 300), owner: a?.owner === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE', due: date(a?.due), done: false })).filter(a => a.text).slice(0, 30),
    mood: Number.isInteger(mood) && mood >= 1 && mood <= 5 ? mood : null,
    moodReason: str(j.moodReason, 300),
    nextDate: date(j.nextDate),
    observations: str(Array.isArray(j.observations) ? j.observations.map(x => `- ${x}`).join('\n') : j.observations, 5000)
  }
}

/** 没有模型时的规则兜底：纪要用原文（太长截前面）；「待办 / TODO / 行动项 / - [ ]」开头的行当待办 */
export function parseByRules(text, { topics }) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean)
  const actions = []
  let inActions = false
  for (const l of lines) {
    if (/^#*\s*(待办|行动项|后续|跟进事项|todo|action items?)[：:]?\s*$/i.test(l)) { inActions = true; continue }
    if (/^#+\s/.test(l) || /^[^-*\d\s].{0,15}[：:]$/.test(l)) inActions = false
    const m = /^(?:[-*•]\s*(?:\[[ x]\]\s*)?|\d+[.、)]\s*)?(?:(?:待办|TODO|行动项)[：:]\s*)?(.+)$/i.exec(l)
    const explicit = /^(?:[-*•]\s*)?(?:\[[ x]\]|(?:待办|TODO|行动项)[：:])/i.test(l)
    if (m && (inActions ? /^(?:[-*•]|\d+[.、)])/.test(l) || explicit : explicit)) actions.push({ text: m[1].slice(0, 300), owner: 'EMPLOYEE', due: null, done: false })
  }
  return {
    date: null, minutes: null, mood: null, moodReason: null, nextDate: null, observations: null,
    topics: topics.filter(t => text.includes(t.slice(0, 2))).slice(0, 4),
    summary: text.length > 3000 ? text.slice(0, 3000) + '\n……（全文见原始纪要）' : text,
    actions: actions.slice(0, 30)
  }
}
