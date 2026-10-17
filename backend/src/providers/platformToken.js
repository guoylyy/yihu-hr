// 用以虎 One「登录方式」里那个钉钉 / 飞书企业内部应用的 access_token（平台 0.6.4+ 的 /api/open/channel-token，只给可信应用）。
// 应用自己的 .env 没配凭证时用它：管理员在平台配一次，人事考勤直接用，不用再抄一遍密钥（飞书本来就要求和平台登录用同一个应用）。
// 平台有没有配、能不能取，后台每 10 分钟看一次，configured() 是同步的，读这里的结果
import { ws } from '../lib/platform.js'

const state = { dingtalk: { ok: false, error: null, token: null, until: 0 }, feishu: { ok: false, error: null, token: null, until: 0 } }

/** 取 token（到期前 5 分钟换新的） */
export async function platformToken(provider) {
  const s = state[provider]
  if (s.token && s.until > Date.now()) return s.token
  if (!ws.enabled) throw new Error('未接入以虎 One，用不了平台的凭证')
  try {
    const r = await ws.channelToken(provider)
    Object.assign(s, { ok: true, error: null, token: r.accessToken, until: Date.parse(r.expiresAt) - 300_000 })
    return s.token
  } catch (e) {
    Object.assign(s, { ok: false, error: e.message, token: null, until: 0 })
    throw e
  }
}

/** token 被对方判失效（过期、换了应用）时丢掉，下次重新取 */
export function resetPlatformToken(provider) {
  Object.assign(state[provider], { token: null, until: 0 })
}

/** 后台刷新：平台配没配、能不能取 */
export async function refreshPlatformChannels() {
  if (!ws.enabled) return
  for (const p of Object.keys(state)) await platformToken(p).catch(() => {})
}

export const platformAvailable = (provider) => state[provider].ok
export const platformError = (provider) => state[provider].error
