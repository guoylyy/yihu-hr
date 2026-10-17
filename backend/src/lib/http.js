// 响应统一 { code: 0, data }；业务里抛 badRequest / forbidden / notFound
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export const badRequest = (m) => new HttpError(400, m)
export const forbidden = (m = '没有权限') => new HttpError(403, m)
export const notFound = (m = '不存在') => new HttpError(404, m)

/** 路由保持薄：wrap(req => svc.fn(req.ctx, ...)) */
export const wrap = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res)
    if (!res.headersSent) res.json({ code: 0, data: data ?? null })
  } catch (e) {
    const status = e.status || 500
    if (status >= 500) console.error('[hr]', req.method, req.originalUrl, e)
    res.status(status).json({ code: status, message: status >= 500 ? '服务器出错了，请稍后再试' : e.message })
  }
}
