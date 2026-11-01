// 「关于」页的运行信息。版本号走 /health，构建时间在前端构建时写入，都不在这里
import { prisma } from '../lib/prisma.js'
import { llmModels } from '../lib/platform.js'
import { defaultModelName } from '../lib/about.js'

export async function aboutInfo() {
  const [db] = await prisma.$queryRaw`SELECT VERSION() AS v`.catch(() => [])
  return {
    dataDir: process.env.DATA_DIR || null,
    database: db?.v ? `MySQL ${db.v}` : null,
    model: defaultModelName(await llmModels()),
    node: process.version
  }
}
