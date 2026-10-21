// 导入时按姓名找人（纯函数，单元测试覆盖）。表里写的名字常和平台上不完全一样：
//   「顾一（产品）」「研发·李强」「郭老师」「小郭」「Guo Yiliang」「yiliangguo」、同音字、错一个字……
// 工号、完全相同、确认过的别名 → 直接认（auto）；其余的按规则打分给几个候选，要人事确认（confirm）；一个都没有 → none
import { pinyin } from 'pinyin-pro'

const COMPOUND = ['欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '宇文', '司徒', '夏侯', '令狐', '钟离', '端木', '南宫', '西门', '独孤', '轩辕']
const TITLES = ['总经理', '总监', '经理', '主任', '主管', '组长', '老师', '老板', '先生', '女士', '小姐', '同学', '博士', '律师', '会计', '师傅', '总', '工', '哥', '姐']
const HAN = /^[一-龥]+$/

/** 去掉括号里的备注、空白，统一大小写 */
export function cleanName(s) {
  return String(s ?? '')
    .replace(/[（(【[<《][^）)】\]>》]*[）)】\]>》]/g, '')
    .replace(/[\s　]+/g, ' ').trim().toLowerCase()
}

/** 「研发·李强」「李强-产品」这类：按分隔符拆开的每一段（含整个） */
function segments(s) {
  const c = cleanName(s)
  const parts = c.split(/[·•・\-_/|，,]+/).map(x => x.trim()).filter(Boolean)
  return [...new Set([c.replace(/\s+/g, ''), ...parts.map(x => x.replace(/\s+/g, ''))])]
}

export function surnameOf(name) {
  const n = String(name || '')
  if (!HAN.test(n)) return null
  return COMPOUND.find(c => n.startsWith(c)) || n[0]
}

/** 「郭老师」「郭总」「小郭」「老郭」→ 姓「郭」；不是这种写法返回 null */
export function titledSurname(s) {
  const n = cleanName(s).replace(/\s+/g, '')
  if (!HAN.test(n)) return null
  let m = /^[小老阿]([一-龥]{1,2})$/.exec(n)
  if (m && (m[1].length === 1 || COMPOUND.includes(m[1]))) return m[1]
  for (const t of TITLES) {
    if (n.length > t.length && n.endsWith(t)) {
      const rest = n.slice(0, -t.length)
      if (rest.length === 1 || COMPOUND.includes(rest)) return rest
    }
  }
  return null
}

/** 拼音的几种拼法：guoyiliang、yiliangguo（名在前）；英文 / 拼音写的名字原样（去空格） */
export function romanKeys(name) {
  const c = cleanName(name)
  const n = c.replace(/\s+/g, '')
  if (!n) return []
  // 英文 / 拼音：「Guo Yiliang」→ guoyiliang、yiliangguo（姓在前在后都认）
  if (/^[a-z]+$/.test(n)) { const t = c.split(' ').filter(Boolean); return [...new Set([t.join(''), [...t].reverse().join('')])] }
  if (!HAN.test(n)) return []
  const syl = pinyin(n, { toneType: 'none', type: 'array' })
  const sn = surnameOf(n)
  const k = sn ? sn.length : 1
  return [...new Set([syl.join(''), [...syl.slice(k), ...syl.slice(0, k)].join('')])]
}

/** 编辑距离（名字很短，直接算） */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** 一个表里的名字和一个员工的相似度：{ score, reason } 或 null（0 ~ 100，越高越像） */
export function scoreName(raw, emp) {
  const a = segments(raw), b = segments(emp.name)
  // 英文名按空格拆开再拼（segments 把空格去掉了），拼音比对要用原样
  const keys = (name, segs) => [...romanKeys(name), ...segs.flatMap(romanKeys)]
  if (a.some(x => b.includes(x))) return { score: 90, reason: '去掉括号 / 部门前缀后一样' }
  const ra = new Set(keys(raw, a)), rb = keys(emp.name, b)
  if (rb.some(k => ra.has(k))) {
    const latin = a.some(x => /^[a-z]+$/.test(x)) || b.some(x => /^[a-z]+$/.test(x))
    return { score: latin ? 75 : 80, reason: latin ? '拼音一样' : '同音（字不一样）' }
  }
  const ts = titledSurname(raw)
  if (ts && b.some(x => surnameOf(x) === ts)) return { score: 60, reason: `姓${ts}（${cleanName(raw)}）` }
  for (const x of a) for (const y of b) {
    if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return { score: 70, reason: '名字包含' }
    if (HAN.test(x) && HAN.test(y) && x.length === y.length && x.length >= 2 && editDistance(x, y) === 1 && surnameOf(x) === surnameOf(y)) return { score: 65, reason: '差一个字' }
  }
  return null
}

/**
 * 找人：rec = { name, jobNumber }；aliases：Map(别名 -> userId)（以前确认过的）
 * 返回 { status: 'auto', employee, method } / { status: 'confirm', candidates: [{ employee, score, reason }] } / { status: 'none', error }
 */
export function matchPerson({ name, jobNumber }, employees, { aliases = new Map(), limit = 5 } = {}) {
  const no = String(jobNumber ?? '').trim()
  const nm = String(name ?? '').trim()
  if (no) {
    const hit = employees.find(e => e.jobNumber && e.jobNumber === no)
    if (hit) return { status: 'auto', employee: hit, method: '工号' }
  }
  if (!nm && !no) return { status: 'none', error: '这一行没有姓名和工号' }
  if (nm) {
    const exact = employees.filter(e => e.name === nm)
    if (exact.length === 1) return { status: 'auto', employee: exact[0], method: '姓名' }
    if (exact.length > 1) return { status: 'confirm', candidates: exact.slice(0, limit).map(e => ({ employee: e, score: 95, reason: `重名（${e.deptPath || '无部门'}）` })) }
    const aliasId = aliases.get(nm)
    const alias = aliasId && employees.find(e => e.id === aliasId)
    if (alias) return { status: 'auto', employee: alias, method: `之前确认过「${nm}」` }
    const cands = employees.map(e => ({ employee: e, ...scoreName(nm, e) })).filter(c => c.score)
      // 在职的排前面
      .sort((x, y) => y.score - x.score || Number(y.employee.active !== false) - Number(x.employee.active !== false))
    if (cands.length) return { status: 'confirm', candidates: cands.slice(0, limit) }
  }
  return { status: 'none', error: `找不到「${nm || no}」${no && nm ? `（工号 ${no}）` : ''}` }
}
