// 大模型回答的 Markdown → HTML：只认标题、粗体、行内代码、链接、列表、表格、分隔线，先整体转义，不放行任何原始 HTML
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/[^\s)]*)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`)
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function markdown(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const out = []
  let list = null // 'ul' | 'ol'
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { close(); continue }
    let m
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); const n = m[1].length <= 2 ? 3 : 4; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { close(); out.push('<hr>'); continue }
    if (line.includes('|') && isRule(lines[i + 1] || '')) {
      close()
      const head = cells(line)
      const body = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) body.push(cells(lines[i]))
      i--
      out.push(`<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.、)]\s+(.*)$/))) {
      const kind = /^\s*\d/.test(line) ? 'ol' : 'ul'
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inline(m[1])}</li>`)
      continue
    }
    close()
    out.push(`<p>${inline(line)}</p>`)
  }
  close()
  return out.join('')
}
