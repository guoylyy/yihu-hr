import { reactive } from 'vue'
import { api } from './api.js'
import { applyBrand } from './theme.js'

export const me = reactive({ loaded: false, version: '', user: null, hr: false, team: false, contracts: false, cost: false, oneOnOne: false, platform: null, sources: [] })

export async function loadMe() {
  // 版本号只认 /health：页面上显示的和平台健康检查看到的是同一个
  const [d, health] = await Promise.all([api.get('me'), fetch('health').then(r => r.json()).catch(() => ({}))])
  Object.assign(me, d, { version: health.version || '', loaded: true })
  applyBrand(d.brand)
  return me
}
