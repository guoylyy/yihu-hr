// 分析建议助手：用以虎 One 的大模型，按提问人的权限调本应用的只读 AI 工具（和 MCP 是同一套），汇总数据、给方向性建议。
// 只分析不改数据；对话不落库（前端带着历史来），使用数据只记调了几轮、几个工具，不记问题和回答原文
import { ws } from '../lib/platform.js'
import { badRequest, forbidden, HttpError } from '../lib/http.js'
import { cleanHistory, runAdvisor, systemPrompt } from '../lib/advisor.js'
import { PROVIDERS } from '../providers/index.js'
import { TOOLS } from '../mcp.js'
import { canSeeTeam, isHr } from './access.js'
import { today } from './contracts.js'

export async function ask(ctx, { messages } = {}) {
  // 给人事和部门负责人用（员工只有自己的数据，没什么可分析的）
  if (!(await canSeeTeam(ctx))) throw forbidden('分析助手给人事和部门负责人用')
  if (!ws.enabled) throw new HttpError(503, '没有接入以虎 One，用不了大模型（本地开发模式）')
  const history = cleanHistory(messages)
  if (!history) throw badRequest('先问一个问题')
  const system = systemPrompt({ today: await today(), user: ctx.user, hr: await isHr(ctx), sources: PROVIDERS.filter(p => p.configured()).map(p => p.label) })
  const r = await runAdvisor({ llm, tools: TOOLS, messages: [{ role: 'system', content: system }, ...history], ctx: { ...ctx, via: 'AI' } })
  ws.track(ctx.user, 'advisor.ask', { rounds: r.rounds, tools: r.steps.length, via: 'ai' })
  return { answer: r.answer, steps: r.steps }
}

/** 调平台大模型；配额用完、模型没配好时把平台的原因带给用户 */
async function llm(opts) {
  try {
    return await ws.llm(opts)
  } catch (e) {
    console.warn(`[hr] advisor 调大模型失败：${e.message}`)
    throw new HttpError(502, `大模型调用失败：${e.message}`)
  }
}
