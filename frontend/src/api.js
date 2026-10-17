// 接口地址一律用相对路径（'api/x'）：应用挂在 /apps/hr/ 下
import { ElMessage } from 'element-plus'

async function request(method, path, body) {
  let r
  try {
    r = await fetch('api/' + path.replace(/^\//, ''), {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })
  } catch (e) {
    ElMessage.error('网络不通，请稍后再试')
    throw e
  }
  // 登录过期：刷新页面，服务端会跳平台统一登录
  if (r.status === 401) {
    window.location.reload()
    throw new Error('未登录')
  }
  const j = await r.json().catch(() => ({ code: r.status, message: `服务器返回 HTTP ${r.status}` }))
  if (j.code !== 0) {
    ElMessage.error(j.message || '出错了')
    throw new Error(j.message)
  }
  return j.data
}

const qs = (q) => {
  const s = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: (path, q) => request('GET', path + qs(q)),
  post: (path, body) => request('POST', path, body || {}),
  patch: (path, body) => request('PATCH', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
  url: (path, q) => 'api/' + path.replace(/^\//, '') + qs(q)
}
