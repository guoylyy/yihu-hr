// 跟随以虎 One 的外观：/api/me 的 brand.theme.tokens 覆盖 styles.css 里的默认变量。没有 brand 就用默认
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (rgb) => '#' + rgb.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, w) => a.map((x, i) => x * (1 - w) + b[i] * w)
const luminance = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

export function applyBrand(brand) {
  const t = brand?.theme?.tokens || {}
  const root = document.documentElement.style
  const set = (name, v) => { if (v !== undefined && v !== null && v !== '') root.setProperty(name, v) }
  const p = hexToRgb(t.primary)
  if (p) {
    const white = [255, 255, 255], black = [0, 0, 0]
    set('--hr-primary', toHex(p))
    set('--hr-on-primary', luminance(p) > 0.6 ? '#1c1917' : '#ffffff')
    set('--el-color-primary', toHex(p))
    for (const [k, w] of [[3, 0.3], [5, 0.5], [7, 0.7], [8, 0.8], [9, 0.9]]) set(`--el-color-primary-light-${k}`, toHex(mix(p, white, w)))
    set('--el-color-primary-dark-2', toHex(mix(p, black, 0.2)))
    set('--hr-primary-soft', toHex(mix(p, white, 0.9)))
  }
  if (hexToRgb(t.highlight)) set('--hr-accent', t.highlight)
  if (hexToRgb(t.bg)) { set('--hr-bg', t.bg); set('--el-bg-color-page', t.bg) }
  if (hexToRgb(t.text)) { set('--hr-text', t.text); set('--el-text-color-primary', t.text) }
  if (hexToRgb(t.border)) { set('--hr-border', t.border); set('--el-border-color', t.border) }
  if (Number.isFinite(Number(t.radius)) && t.radius !== '') {
    set('--hr-radius', `${Number(t.radius)}px`)
    set('--el-border-radius-base', `${Math.min(Number(t.radius), 8)}px`)
  }
  if (t.font) set('--hr-font', t.font)
}
