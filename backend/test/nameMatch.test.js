import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanName, matchPerson, romanKeys, scoreName, titledSurname } from '../src/lib/nameMatch.js'

const E = [
  { id: 1, name: '顾一', jobNumber: 'E1', deptPath: '公司/产品部' },
  { id: 2, name: '郭一亮', jobNumber: 'E2', deptPath: '公司/研发部' },
  { id: 3, name: '研发·李强', jobNumber: null, deptPath: '公司/研发部' },
  { id: 4, name: '张伟', jobNumber: 'E4', deptPath: '公司/销售部' },
  { id: 5, name: '张伟', jobNumber: 'E5', deptPath: '公司/财务部' },
  { id: 6, name: 'yiliangguo', jobNumber: null, deptPath: '公司' },
  { id: 7, name: '欧阳娜娜', jobNumber: null, deptPath: '公司' },
  { id: 8, name: '王晓明', jobNumber: null, deptPath: '公司' }
]
const top = (name, extra) => {
  const r = matchPerson({ name, ...extra }, E)
  return r.status === 'auto' ? ['auto', r.employee.id] : r.status === 'confirm' ? ['confirm', r.candidates.map(c => c.employee.id)] : ['none']
}

test('写法规范：括号备注、称呼', () => {
  assert.equal(cleanName('顾一（产品）'), '顾一')
  assert.equal(cleanName('顾一(PM) '), '顾一')
  assert.equal(titledSurname('郭老师'), '郭')
  assert.equal(titledSurname('小郭'), '郭')
  assert.equal(titledSurname('欧阳总'), '欧阳')
  assert.equal(titledSurname('郭一亮'), null)
  assert.deepEqual(romanKeys('郭一亮'), ['guoyiliang', 'yiliangguo'])
  assert.deepEqual(romanKeys('Guo Yiliang'), ['guoyiliang', 'yiliangguo'])
})

test('直接认：工号、完全相同', () => {
  assert.deepEqual(top('随便', { jobNumber: 'E2' }), ['auto', 2])
  assert.deepEqual(top('顾一'), ['auto', 1])
})

test('要确认：括号、部门前缀、称呼、拼音、同音、差一个字、重名', () => {
  assert.deepEqual(top('顾一（产品）'), ['confirm', [1]])
  assert.deepEqual(top('李强'), ['confirm', [3]])
  assert.deepEqual(top('郭老师'), ['confirm', [2]])
  assert.deepEqual(top('Guo Yiliang'), ['confirm', [2, 6]])
  assert.deepEqual(top('郭亦良'), ['confirm', [2, 6]])
  assert.deepEqual(top('王小明'), ['confirm', [8]])
  assert.deepEqual(top('张伟'), ['confirm', [4, 5]])
  assert.equal(scoreName('Guo Yiliang', E[1]).reason, '拼音一样')
  assert.equal(scoreName('郭亦良', E[1]).reason, '同音（字不一样）')
})

test('别名：确认过的直接认；对不上的报找不到', () => {
  const r = matchPerson({ name: '郭老师' }, E, { aliases: new Map([['郭老师', 2]]) })
  assert.equal(r.status, 'auto')
  assert.match(r.method, /之前确认过/)
  assert.deepEqual(top('赵六'), ['none'])
  assert.deepEqual(top(''), ['none'])
})
