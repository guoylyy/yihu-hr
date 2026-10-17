// 和以虎 One 打交道的地方：统一登录（SDK）、发消息、应用信息（外观）
import { Workspace } from './yh-one.mjs'

export const ws = new Workspace()

/** 本地开发（没配 YH_CLIENT_ID）时以这个人的身份访问；生产环境永远不用 */
export function devUser() {
  if (ws.enabled || process.env.NODE_ENV === 'production') return null
  const id = Number(process.env.DEV_USER_ID || 1)
  const leaderOf = String(process.env.DEV_LEADER_OF || '').split(',').map(Number).filter(Boolean)
  return { id, name: process.env.DEV_USER_NAME || '本地开发', roles: process.env.DEV_ADMIN === '1' ? ['ADMIN'] : ['MEMBER'], depts: [], leaderOf }
}

const appBasic = () => ({ Authorization: ws.basic() })

/** 平台用户主数据（只有本应用所在空间的人） */
export async function fetchUsers({ updatedSince } = {}) {
  const q = new URLSearchParams({ includeInactive: 'true', ...(updatedSince ? { updatedSince: updatedSince.toISOString() } : {}) })
  return ws.call('GET', `/api/open/users?${q}`, { headers: appBasic() })
}

/** 经平台的钉钉 / 飞书 / 企业微信给个人发消息。是提醒，失败只打日志 */
export async function notify(userIds, { title, content, path }) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ws.enabled || !ids.length) return
  try {
    await ws.call('POST', '/api/open/notify', {
      body: { userIds: ids.slice(0, 100), title, content, ...(path ? { url: `${ws.appUrl}/#${path}` } : {}) },
      headers: appBasic()
    })
  } catch (e) {
    console.warn(`[hr] 发消息失败：${e.message}`)
  }
}

let appInfoCache = null
/** 应用信息（所属空间、平台外观），缓存 10 分钟 */
export async function appInfo() {
  if (!ws.enabled) return null
  if (appInfoCache && appInfoCache.until > Date.now()) return appInfoCache.data
  try {
    const data = await ws.call('GET', '/api/open/app', { headers: appBasic() })
    appInfoCache = { data, until: Date.now() + 600_000 }
    return data
  } catch (e) {
    console.warn(`[hr] 取应用信息失败：${e.message}`)
    return appInfoCache?.data || null
  }
}

export const appUrl = (path = '/') => (ws.appUrl ? `${ws.appUrl}/#${path}` : undefined)
