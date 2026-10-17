import { reactive } from 'vue'
import { api } from './api.js'
import { applyBrand } from './theme.js'

export const me = reactive({ loaded: false, version: '', user: null, hr: false, team: false, approver: false, contracts: false, cost: false, oneOnOne: false, platform: null, sources: [] })

export async function loadMe() {
  const d = await api.get('me')
  Object.assign(me, d, { loaded: true })
  applyBrand(d.brand)
  return me
}
