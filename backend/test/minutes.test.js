import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanText, extractText, fromSubtitles, parseByRules, sanitizeParsed } from '../src/lib/minutes.js'

const TOPICS = ['工作进展', '目标与优先级', '困难与支持', '反馈', '成长与学习', '职业发展', '团队协作', '状态与生活']

test('字幕：去序号和时间轴，同一个人连续说的合并', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n张三：你好\n\n2\n00:00:03,000 --> 00:00:05,000\n张三：最近怎么样\n\n3\n00:00:05,500 --> 00:00:07,000\n李四：还行，有点忙'
  assert.equal(fromSubtitles(srt), '张三：你好 最近怎么样\n李四：还行，有点忙')
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v 王五>早\n\n00:00:02.000 --> 00:00:03.000\n<v 王五>开始吧'
  assert.equal(fromSubtitles(vtt), '王五：早 开始吧')
})

test('抽文字：txt / md 原样（去 BOM），不支持的格式报错', async () => {
  assert.equal(await extractText(Buffer.from('﻿纪要\r\n\r\n\r\n\r\n内容  \n'), 'a.txt'), '纪要\n\n内容')
  await assert.rejects(() => extractText(Buffer.from('x'), 'a.mp3'), /不支持 \.mp3/)
  assert.equal(cleanText('a\n\n\n\nb'), 'a\n\nb')
})

test('抽文字：docx', async () => {
  // 最小的 docx：只有 document.xml
  const { default: JSZip } = await import('jszip').catch(() => ({ default: null }))
  if (!JSZip) return
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>1v1 纪要</w:t></w:r></w:p><w:p><w:r><w:t>待办：周五前交方案</w:t></w:r></w:p></w:body></w:document>')
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  assert.equal(await extractText(buf, '纪要.docx'), '1v1 纪要\n\n待办：周五前交方案')
})

test('模型结果校验：话题只留预设的、日期和状态要合规、待办的负责人只有两种', () => {
  const d = sanitizeParsed({
    date: '2026-10-20', minutes: '45', topics: ['工作进展', '升职加薪', '职业发展'], summary: ['项目按期', '想做技术管理'],
    actions: [{ text: '周五交方案', owner: 'EMPLOYEE', due: '2026-10-24' }, { text: '帮他约架构评审', owner: 'MANAGER', due: '下周' }, { text: '' }],
    mood: 6, nextDate: 'x', observations: ['有些焦虑']
  }, { topics: TOPICS })
  assert.deepEqual(d.topics, ['工作进展', '职业发展'])
  assert.equal(d.summary, '- 项目按期\n- 想做技术管理')
  assert.equal(d.minutes, 45)
  assert.deepEqual(d.actions.map(a => [a.text, a.owner, a.due]), [['周五交方案', 'EMPLOYEE', '2026-10-24'], ['帮他约架构评审', 'MANAGER', null]])
  assert.equal(d.mood, null)
  assert.equal(d.nextDate, null)
  assert.equal(d.observations, '- 有些焦虑')
})

test('规则兜底：「待办」标记的行、待办小节下的条目', () => {
  const t = '本周工作进展顺利\n- [ ] 整理接口文档\n待办：周五前交方案\n\n行动项：\n1. 约架构评审\n2. 更新排期\n\n其他：\n- 状态不错'
  const d = parseByRules(t, { topics: TOPICS })
  assert.deepEqual(d.actions.map(a => a.text), ['整理接口文档', '周五前交方案', '约架构评审', '更新排期'])
  assert.deepEqual(d.topics, ['工作进展', '状态与生活'])
  assert.equal(d.summary, t)
})
