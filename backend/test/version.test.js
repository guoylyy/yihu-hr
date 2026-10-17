import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { VERSION } from '../src/lib/version.js'

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))

test('版本号：前后端一致，CHANGELOG 有这个版本', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  assert.equal(read('../../frontend/package.json').version, VERSION, '前端版本和后端不一致：用 ./bump-version.sh 改')
  assert.equal(read('../package-lock.json').version, VERSION)
  const log = fs.readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
  assert.ok(log.includes(`## ${VERSION} `), `CHANGELOG.md 里没有 ${VERSION} 的说明`)
  assert.ok(!log.includes('（在这里写这个版本的变化'), 'CHANGELOG.md 里还有没填的说明')
})

test('SDK 副本有本应用用到的方法（以平台仓库的 sdk/yh-one.mjs 为准，改了要同步过来）', async () => {
  const { Workspace } = await import('../src/lib/yh-one.mjs')
  const ws = new Workspace({ clientId: 'a', clientSecret: 'b' })
  for (const m of ['channelToken', 'logoutUrl', 'logout', 'userFromToken', 'track']) assert.equal(typeof ws[m], 'function', `SDK 副本缺 ${m}：从以虎 One 仓库 console/frontend/public/sdk/yh-one.mjs 拷过来`)
  assert.equal(typeof ws.storage?.put, 'function')
})
