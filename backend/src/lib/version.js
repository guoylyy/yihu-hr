// 应用版本号：以 backend/package.json 为准（以虎 One「管理 → 应用」的版本列也读它）；改版本只用根目录的 bump-version.sh
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '0.0.0' } catch { return '0.0.0' } })()
