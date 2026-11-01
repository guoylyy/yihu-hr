import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultModelName } from '../src/lib/about.js'

test('关于页的 AI 模型：优先 default，其次第一个，没有就是 null', () => {
  assert.equal(defaultModelName([{ id: 'a' }, { id: 'b', default: true }]), 'b')
  assert.equal(defaultModelName([{ id: 'a', name: '通义' }]), '通义')
  assert.equal(defaultModelName([]), null)
  assert.equal(defaultModelName(null), null)
})
