// 三家开放平台的 HTTP 调用：超时、JSON、把出错信息带上来源
export async function callJson(label, url, { method = 'GET', body, headers } = {}) {
  let r
  try {
    r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    throw new Error(`连不上${label}开放平台：${e.message}`)
  }
  const j = await r.json().catch(() => null)
  if (!j) throw new Error(`${label}开放平台返回 HTTP ${r.status}，不是 JSON`)
  return j
}

/** access_token 缓存：提前 5 分钟过期 */
export function tokenCache(fetchToken) {
  let cached = null
  const get = async () => {
    if (cached && cached.until > Date.now()) return cached.token
    const { token, expiresIn } = await fetchToken()
    cached = { token, until: Date.now() + Math.max(60, (expiresIn || 7200) - 300) * 1000 }
    return token
  }
  get.reset = () => { cached = null }
  return get
}
