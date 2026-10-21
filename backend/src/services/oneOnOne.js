// 1v1 记录：负责人给下属记（人事给任何人记）。谁能看：
//   记录人、他上面的负责人、人事：全部（私人备注只有记录人和人事）
//   本人：标了「本人可见」的纪要和待办（看不到私人备注），可以勾掉自己的待办
// 纪要是敏感内容：留痕和上报平台的使用数据里不放原文
// 导入会议纪要：上传原文件（以虎 One 文件存储，key 固定 one-on-ones/<userId>/…）或粘贴文字 → 抽出全文 → 平台大模型解析成
//   纪要、话题、待办、状态、下次时间、观察（建议放私人备注）→ 填进表单，负责人改好再保存。原文件、全文、解析结果都跟着记录存
//   原始纪要（文件和全文）给记录人、上级、人事看；本人默认看不到（可能有负责人的私下评价），勾了「原始纪要给本人看」才能看
import { prisma } from '../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { diffDays, isDateStr } from '../lib/dates.js'
import { canLog1v1, isHr, visibleScope } from './access.js'
import { ws } from '../lib/platform.js'
import { FILE_EXT, MAX_TEXT, cleanText, extOf, extractText, parseByRules, sanitizeParsed } from '../lib/minutes.js'
import { audit } from './audit.js'
import { employeeBrief } from './directory.js'
import { today } from './contracts.js'
import { getSettings } from './settings.js'

export const TOPICS = ['工作进展', '目标与优先级', '困难与支持', '反馈', '成长与学习', '职业发展', '团队协作', '状态与生活']
const OWNERS = { EMPLOYEE: '本人', MANAGER: '负责人' }

/** 当前用户对这条记录的权限：none / own（本人看共享部分）/ full（看全部，不含私人备注）/ author（含私人备注，可改） */
async function accessOf(ctx, m) {
  if (m.managerId === ctx.user.id) return 'author'
  if (await isHr(ctx)) return 'author'
  if (m.userId === ctx.user.id) return m.shared ? 'own' : 'none'
  const s = await visibleScope(ctx)
  return s.ids.has(m.userId) ? 'full' : 'none'
}

function dto(m, level, names) {
  const actions = (Array.isArray(m.actions) ? m.actions : []).map((a, i) => ({ index: i, text: a.text, owner: a.owner, ownerLabel: OWNERS[a.owner] || '', due: a.due || null, done: !!a.done }))
  return {
    id: m.id, userId: m.userId, managerId: m.managerId, employee: names.get(m.userId) || null, manager: names.get(m.managerId) || null,
    date: m.date, minutes: m.minutes, mood: level === 'own' ? null : m.mood, topics: m.topics || [], notes: m.notes, actions,
    privateNote: level === 'author' ? m.privateNote : undefined, nextDate: m.nextDate, shared: m.shared,
    // 原始纪要：本人只有勾了「给本人看」才有
    ...((level !== 'own' || m.sourceShared)
      ? { hasFile: !!m.sourceFileKey, sourceFileName: m.sourceFileName, sourceFileSize: m.sourceFileSize, sourceChars: m.sourceText?.length || 0, parsedBy: m.parsed?.by || null }
      : { hasFile: false, sourceChars: 0 }),
    sourceShared: m.sourceShared,
    canEdit: level === 'author', updatedAt: m.updatedAt
  }
}

async function briefMap(ids) {
  const rows = await prisma.employee.findMany({ where: { id: { in: [...new Set(ids)] } } })
  return new Map(rows.map(e => [e.id, employeeBrief(e)]))
}

/** 某人的 1v1 记录（userId 不给 = 自己），按日期倒序 */
export async function listFor(ctx, { userId } = {}) {
  const uid = Number(userId) || ctx.user.id
  const rows = await prisma.oneOnOne.findMany({ where: { userId: uid, deletedAt: null }, orderBy: [{ date: 'desc' }, { id: 'desc' }] })
  const out = []
  for (const m of rows) {
    const level = await accessOf(ctx, m)
    if (level !== 'none') out.push([m, level])
  }
  if (uid !== ctx.user.id && !out.length && !(await canLog1v1(ctx, uid))) throw forbidden('只能看自己和下属的 1v1')
  const names = await briefMap(out.flatMap(([m]) => [m.userId, m.managerId]))
  return { employee: (await briefMap([uid])).get(uid) || null, rows: out.map(([m, l]) => dto(m, l, names)), canLog: await canLog1v1(ctx, uid), topics: TOPICS }
}

/** 统计：每人最近一次 1v1、待办没完成的条数（人员全景、画像用）。userIds 不给 = 全部 */
export async function stats(userIds) {
  const rows = await prisma.oneOnOne.findMany({ where: { deletedAt: null, ...(userIds ? { userId: { in: userIds } } : {}) }, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: { userId: true, date: true, mood: true, actions: true, nextDate: true } })
  const m = new Map()
  for (const r of rows) {
    const s = m.get(r.userId) || { last: null, count: 0, openActions: 0, moods: [] }
    if (!s.last) s.last = { date: r.date, mood: r.mood, nextDate: r.nextDate }
    s.count++
    if (s.moods.length < 6 && r.mood != null) s.moods.unshift({ date: r.date, mood: r.mood })
    s.openActions += (Array.isArray(r.actions) ? r.actions : []).filter(a => !a.done).length
    m.set(r.userId, s)
  }
  return m
}

/** 我的 1v1 名单：能记 1v1 的人（负责人 = 下属，人事 = 全部），带最近一次、下次、是否超期 */
export async function roster(ctx, { keyword } = {}) {
  const scope = await visibleScope(ctx)
  let emps = await prisma.employee.findMany({ where: { active: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) }, orderBy: [{ deptPath: 'asc' }, { name: 'asc' }] })
  emps = emps.filter(e => e.id !== ctx.user.id)
  const k = String(keyword || '').trim()
  if (k) emps = emps.filter(e => e.name.includes(k) || e.jobNumber?.includes(k) || e.deptPath?.includes(k))
  const st = await stats(emps.map(e => e.id))
  const day = await today()
  const cadence = (await getSettings()).oneOnOneCadenceDays
  const rows = emps.map(e => {
    const s = st.get(e.id)
    const since = s?.last ? diffDays(s.last.date, day) : null
    return {
      employee: employeeBrief(e), count: s?.count || 0, last: s?.last || null, sinceDays: since, openActions: s?.openActions || 0,
      // 不参与考核的人（如董事）不催 1v1
      overdue: e.exemption !== 'FULL' && cadence > 0 && (since == null || since > cadence), nextDue: s?.last?.nextDate && s.last.nextDate <= day
    }
  })
  rows.sort((a, b) => (b.overdue - a.overdue) || ((b.sinceDays ?? 1e9) - (a.sinceDays ?? 1e9)))
  return { rows, cadence, isHr: scope.all }
}

function cleanActions(list) {
  if (!Array.isArray(list)) return []
  return list.filter(a => a && String(a.text || '').trim()).slice(0, 30).map(a => {
    if (a.due && !isDateStr(a.due)) throw badRequest('待办的期限要写 YYYY-MM-DD')
    return { text: String(a.text).trim().slice(0, 300), owner: OWNERS[a.owner] ? a.owner : 'EMPLOYEE', due: a.due || null, done: !!a.done }
  })
}

/** 新建或修改（body.id 有值是改，只有记录人和人事能改） */
export async function save(ctx, body = {}) {
  const id = body.id ? Number(body.id) : null
  const cur = id ? await prisma.oneOnOne.findFirst({ where: { id, deletedAt: null } }) : null
  if (id && !cur) throw notFound('没有这条记录')
  if (cur && (await accessOf(ctx, cur)) !== 'author') throw forbidden('只有记录人和人事能改')
  const userId = cur ? cur.userId : Number(body.userId)
  if (!cur && !(await canLog1v1(ctx, userId))) throw forbidden('只能给自己的下属记 1v1（人事能给任何人记）')
  if (!isDateStr(body.date || cur?.date)) throw badRequest('日期要写 YYYY-MM-DD')
  if (body.nextDate && !isDateStr(body.nextDate)) throw badRequest('下次时间要写 YYYY-MM-DD')
  const mood = body.mood == null || body.mood === '' ? null : Number(body.mood)
  if (mood != null && !(Number.isInteger(mood) && mood >= 1 && mood <= 5)) throw badRequest('状态是 1 ~ 5')
  const data = {
    date: body.date || cur.date,
    minutes: body.minutes ? Math.min(600, Math.max(1, Math.round(Number(body.minutes)))) : null,
    mood,
    topics: Array.isArray(body.topics) ? body.topics.map(t => String(t).slice(0, 20)).slice(0, 12) : [],
    notes: body.notes ? String(body.notes).slice(0, 20000) : null,
    privateNote: body.privateNote ? String(body.privateNote).slice(0, 20000) : null,
    actions: cleanActions(body.actions),
    nextDate: body.nextDate || null,
    shared: body.shared !== false,
    sourceShared: !!body.sourceShared
  }
  // 导入的纪要（不传就不动）
  if (body.sourceFileKey !== undefined) {
    const key = body.sourceFileKey || null
    if (key && (!key.startsWith(`one-on-ones/${userId}/`) || key.includes('..'))) throw badRequest('纪要文件的位置不对')
    Object.assign(data, { sourceFileKey: key, sourceFileName: key ? String(body.sourceFileName || '').slice(0, 200) || null : null, sourceFileSize: key ? Number(body.sourceFileSize) || null : null })
  }
  if (body.sourceText !== undefined) data.sourceText = body.sourceText ? cleanText(body.sourceText) : null
  if (body.parsed !== undefined) data.parsed = body.parsed && typeof body.parsed === 'object' ? JSON.parse(JSON.stringify(body.parsed).slice(0, 60000)) : null
  const m = cur
    ? await prisma.oneOnOne.update({ where: { id }, data })
    : await prisma.oneOnOne.create({ data: { ...data, userId, managerId: ctx.user.id } })
  audit(ctx, cur ? 'one_on_one.update' : 'one_on_one.create', { entityType: 'employee', entityId: userId, detail: { id: m.id, date: m.date, shared: m.shared, imported: !!(m.sourceText || m.sourceFileKey) } })
  const names = await briefMap([m.userId, m.managerId])
  return dto(m, 'author', names)
}

export async function remove(ctx, id) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m) throw notFound('没有这条记录')
  if ((await accessOf(ctx, m)) !== 'author') throw forbidden('只有记录人和人事能删')
  await prisma.oneOnOne.update({ where: { id: m.id }, data: { deletedAt: new Date() } })
  audit(ctx, 'one_on_one.remove', { entityType: 'employee', entityId: m.userId, detail: { id: m.id } })
  return { ok: true }
}

/** 勾掉 / 取消一项待办：记录人、人事；本人只能勾「本人」的 */
export async function toggleAction(ctx, id, { index, done } = {}) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m) throw notFound('没有这条记录')
  const level = await accessOf(ctx, m)
  const actions = Array.isArray(m.actions) ? [...m.actions] : []
  const a = actions[Number(index)]
  if (!a) throw badRequest('没有这项待办')
  if (!(level === 'author' || (level === 'own' && a.owner === 'EMPLOYEE'))) throw forbidden('不能改这项待办')
  actions[Number(index)] = { ...a, done: !!done }
  await prisma.oneOnOne.update({ where: { id: m.id }, data: { actions } })
  audit(ctx, 'one_on_one.action', { entityType: 'employee', entityId: m.userId, detail: { id: m.id, done: !!done } })
  return { ok: true }
}

// ---------- 导入会议纪要 ----------
const FILE_MAX_MB = 50

let storageCache = null
export async function storageEnabled() {
  if (!ws.enabled) return false
  if (storageCache && storageCache.until > Date.now()) return storageCache.value
  const value = await ws.storage.info().then(i => !!i.enabled).catch(() => false)
  storageCache = { value, until: Date.now() + 60_000 }
  return value
}

/** 能给这个人导纪要：能给他记 1v1（新记录），或者是这条记录的记录人 / 人事（改记录） */
async function checkCanImport(ctx, userId, recordId) {
  if (recordId) {
    const cur = await prisma.oneOnOne.findFirst({ where: { id: Number(recordId), deletedAt: null } })
    if (!cur || (await accessOf(ctx, cur)) !== 'author') throw forbidden('只有记录人和人事能改')
    return cur.userId
  }
  if (!(await canLog1v1(ctx, Number(userId)))) throw forbidden('只能给自己的下属记 1v1（人事能给任何人记）')
  return Number(userId)
}

/** 浏览器直传原文件的凭证。平台没开文件存储时 storage: false（前端改成把文件直接交给解析，不留原文件） */
export async function uploadToken(ctx, { userId, recordId, fileName, size } = {}) {
  const uid = await checkCanImport(ctx, userId, recordId)
  if (!FILE_EXT.includes(extOf(fileName))) throw badRequest(`支持 ${FILE_EXT.map(x => '.' + x).join(' ')}（飞书妙记、钉钉闪记、腾讯会议导出的纪要 / 文字稿）`)
  if (Number(size) > FILE_MAX_MB * 1024 * 1024) throw badRequest(`文件不能超过 ${FILE_MAX_MB} MB`)
  if (!(await storageEnabled())) return { storage: false }
  const safe = String(fileName).replace(/[\\/\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(-120)
  const key = `one-on-ones/${uid}/${Date.now()}-${safe}`
  const t = await ws.storage.uploadToken({ key, maxSizeMB: FILE_MAX_MB, overwrite: false, expires: 1800 })
  return { storage: true, key, fullKey: t.fullKey, token: t.token, uploadUrl: t.uploadUrl }
}

const SYSTEM = '你是帮管理者整理 1v1 谈话记录的助手。只输出一个 JSON 对象，不要解释。只写纪要里确实有的内容，不编造；拿不准的给 null。'

/** 太长的纪要：留开头和结尾（结论、待办通常在后面） */
const clip = (t, n = 60000) => (t.length <= n ? t : `${t.slice(0, Math.round(n * 0.7))}\n……（中间省略）……\n${t.slice(-Math.round(n * 0.3))}`)

async function parseByAi(text, { employee, manager, topics, today }) {
  const r = await ws.llm({
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `下面是负责人「${manager}」和下属「${employee}」一次 1v1 的会议纪要 / 文字稿（可能是录音转写，有口语和错字）。今天是 ${today}。整理成：
- date：开会日期 YYYY-MM-DD（纪要里有才写）
- minutes：时长（分钟，有才写）
- topics：从这些里选：${topics.join('、')}
- summary：纪要，3 ~ 10 条要点（进展、问题、共识、决定），每条一句话，用数组
- actions：待办 [{ "text": 要做的事, "owner": "EMPLOYEE"（${employee}做）或 "MANAGER"（${manager}做）, "due": 期限 YYYY-MM-DD 或 null }]，「下周」「月底」按今天推算
- mood：${employee}的状态 1 很差 ~ 5 很好（从语气、内容判断，判断不了给 null），moodReason：一句话理由
- nextDate：约好的下次 1v1 日期（有才写）
- observations：给负责人自己看的观察（风险、情绪、离职倾向、需要支持的地方），数组，没有就空数组

纪要：
${clip(text)}` }
    ]
  })
  const content = r.choices?.[0]?.message?.content || ''
  const m = content.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('模型没有返回 JSON')
  return JSON.parse(m[0])
}

/**
 * 解析纪要，返回表单草稿（不保存）。body：{ userId | recordId, fileKey（已直传的）| fileBase64 + fileName（没开文件存储时）| text（粘贴的）}
 * 返回 { sourceText, file: { key, name, size } | null, draft, by: AI | RULE, aiError }
 */
export async function parseMinutes(ctx, body = {}) {
  const uid = await checkCanImport(ctx, body.userId, body.recordId)
  let text, file = null
  if (body.fileKey) {
    if (!String(body.fileKey).startsWith(`one-on-ones/${uid}/`)) throw badRequest('纪要文件的位置不对')
    const buf = await ws.storage.get(body.fileKey)
    text = await extractText(buf, body.fileName || body.fileKey)
    file = { key: body.fileKey, name: String(body.fileName || body.fileKey.split('/').pop()).slice(0, 200), size: buf.length }
  } else if (body.fileBase64) {
    const buf = Buffer.from(String(body.fileBase64), 'base64')
    if (buf.length > 4 * 1024 * 1024) throw badRequest('平台没开文件存储时一次最多传 4 MB；文件大的请让管理员开通文件存储')
    text = await extractText(buf, body.fileName)
  } else {
    text = cleanText(body.text)
  }
  if (!text) throw badRequest('没读到文字：文件是扫描件 / 图片的话，请导出文字版再传')
  const emp = await prisma.employee.findUnique({ where: { id: uid } })
  const topics = TOPICS
  let raw = null, by = 'RULE', aiError = null
  if (ws.enabled) {
    try {
      raw = await parseByAi(text, { employee: emp?.name || '下属', manager: ctx.user.name || '负责人', topics, today: await today() })
      by = 'AI'
    } catch (e) {
      aiError = `大模型没用上（${e.message}），按规则整理了一份，请自己补充`
    }
  } else {
    aiError = '没接入以虎 One 的大模型，按规则整理了一份（纪要用原文、带「待办」标记的行当待办），请自己补充'
  }
  const draft = by === 'AI' ? sanitizeParsed(raw, { topics }) : parseByRules(text, { topics })
  audit(ctx, 'one_on_one.parse', { entityType: 'employee', entityId: uid, detail: { by, chars: text.length, file: !!file } })
  return { sourceText: text, truncated: text.length >= MAX_TEXT, file, draft, by, aiError, parsedAt: new Date().toISOString() }
}

/** 原始纪要全文和解析结果（名单里不带全文，点开再取） */
export async function sourceOf(ctx, id) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m) throw notFound('没有这条记录')
  const level = await accessOf(ctx, m)
  if (level === 'none' || (level === 'own' && !m.sourceShared)) throw forbidden()
  return { sourceText: m.sourceText, parsed: level === 'author' || level === 'full' ? m.parsed : null, hasFile: !!m.sourceFileKey, sourceFileName: m.sourceFileName }
}

/** 下载原文件：能看原始纪要的人（检查权限后跳 5 分钟有效的地址） */
export async function sourceFileUrl(ctx, id) {
  const m = await prisma.oneOnOne.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!m?.sourceFileKey) throw notFound('这条 1v1 没有原文件')
  const level = await accessOf(ctx, m)
  if (level === 'none' || (level === 'own' && !m.sourceShared)) throw forbidden()
  audit(ctx, 'one_on_one.file', { entityType: 'employee', entityId: m.userId, detail: { id: m.id } })
  return ws.storage.url(m.sourceFileKey, { expires: 300, filename: m.sourceFileName || undefined })
}
