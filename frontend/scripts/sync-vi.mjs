// 把平台的设计令牌同步到 src/yh-vi.css。平台改 VI → 跑一次 → 应用跟上
//   npm run sync-vi                  从 ../yihu-one 同步
//   npm run sync-vi -- --check       只比较，不一致时退出码 1
//   --from <main.css> --to <yh-vi.css>  换来源或目标
// 取法和到期台账、会议的同名脚本一样：--yh-* 全要，--el-* 只留三个，其余 Element 令牌在 styles.css 里从 --yh-* 推出来
import { readFileSync, writeFileSync } from 'node:fs'

const HEADER = '/* 由 scripts/sync-vi.mjs 从 yihu-one 平台同步，勿手改 */'
const DEFAULT_FROM = '../../yihu-one/console/frontend/src/styles/main.css'
const DEFAULT_TO = 'src/yh-vi.css'
const EL_KEEP = ['--el-color-primary', '--el-color-success', '--el-color-danger']
const here = (p) => new URL(`../${p}`, import.meta.url)

/** 取第一个 :root { } 里的令牌，顺序和值都不动 */
function readTokens(css) {
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1]
  if (!block) throw new Error('来源文件里没有 :root { } 块')
  const out = []
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1].startsWith('--yh-') || EL_KEEP.includes(m[1])) out.push([m[1], m[2].trim()])
  }
  if (!out.length) throw new Error('来源文件的 :root 里没有 --yh-* 令牌')
  return out
}

const render = (tokens) => `${HEADER}\n:root {\n${tokens.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`

const argv = process.argv.slice(2)
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const from = opt('--from', here(DEFAULT_FROM))
const to = opt('--to', here(DEFAULT_TO))
const tokens = readTokens(readFileSync(from, 'utf8'))
const next = render(tokens)

if (argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(to, 'utf8') } catch { /* 还没同步过：算不一致 */ }
  if (next === current) console.log(`令牌一致，共 ${tokens.length} 个`)
  else {
    console.error('令牌和平台不一致，跑一次 npm run sync-vi')
    process.exitCode = 1
  }
} else {
  writeFileSync(to, next)
  console.log(`已同步 ${tokens.length} 个令牌`)
}
