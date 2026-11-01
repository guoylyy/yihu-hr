// 跟随以虎 One 的外观：/api/me 的 brand.theme.tokens 覆盖 yh-vi.css 的 --yh-* 默认值。
// 只写 --yh-*：--hr-* 和 --el-* 在 styles.css 里都指向 --yh-*，跟着变。没有 brand 就用 yh-vi.css
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
    set('--yh-primary', toHex(p))
    set('--yh-on-primary', hexToRgb(t.onPrimary) ? t.onPrimary : luminance(p) > 0.6 ? 'var(--yh-text)' : 'var(--yh-card)')
    set('--yh-primary-dark', toHex(luminance(p) < 0.25 ? mix(p, white, 0.18) : mix(p, black, 0.2)))
    set('--yh-primary-soft', toHex(mix(p, white, 0.9)))
  }
  if (hexToRgb(t.highlight)) set('--yh-highlight', t.highlight)
  if (hexToRgb(t.bg)) set('--yh-bg', t.bg)
  if (hexToRgb(t.text)) set('--yh-text', t.text)
  if (hexToRgb(t.border)) set('--yh-border', t.border)
  if (Number.isFinite(Number(t.radius)) && t.radius !== '') {
    set('--yh-radius', `${Number(t.radius)}px`)
    set('--yh-radius-sm', `${Math.round(Number(t.radius) * 2 / 3)}px`)
  }
  if (t.font) set('--yh-font', t.font)
}
