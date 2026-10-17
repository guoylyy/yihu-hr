// 写操作留痕：本地 AuditLog + 上报平台使用数据（detail 里不放原文）
import { prisma } from '../lib/prisma.js'
import { ws } from '../lib/platform.js'

export function audit(ctx, action, { entityType, entityId, detail } = {}) {
  ws.track(ctx.user, action, { ...(detail || {}), ...(ctx.via === 'AI' ? { via: 'ai' } : {}) })
  prisma.auditLog.create({
    data: { actorId: ctx.user?.id ?? null, via: ctx.via || 'WEB', action, entityType, entityId: entityId == null ? null : String(entityId), detail: detail ?? undefined }
  }).catch(e => console.warn(`[hr] 写审计日志失败：${e.message}`))
}
