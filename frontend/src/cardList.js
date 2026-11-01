// v-card-list：窄屏把 el-table 降级成卡片（样式在 styles.css 的 [data-card-list]）。
// el-table 不让给单元格加属性，这里在渲染后把表头文字抄到每格的 data-label；选择框、合计行一起处理。
// 标记都用 data-*：el-table 重绘时会整个覆盖 class，加上的类名留不住
function label(el) {
  const heads = [...el.querySelectorAll('.el-table__header-wrapper thead th')]
  const titles = heads.map(th => (th.querySelector('input') ? '' : th.textContent.trim()))
  // 带勾选框的表头留着：窄屏靠它全选
  heads.forEach(th => th.toggleAttribute('data-keep', !!th.querySelector('input')))
  el.toggleAttribute('data-select', heads.some(th => th.querySelector('input')))
  for (const tr of el.querySelectorAll('.el-table__body-wrapper tbody tr, .el-table__footer-wrapper tfoot tr')) {
    ;[...tr.children].forEach((td, i) => {
      const text = titles[i] ?? ''
      if (td.dataset.label !== text) td.dataset.label = text
    })
  }
}

const watchers = new WeakMap()

export const cardList = {
  mounted(el) {
    el.setAttribute('data-card-list', '')
    label(el)
    // 翻页、换筛选时表体是 el-table 自己重画的，父组件的 updated 不一定触发
    const ob = new MutationObserver(() => label(el))
    ob.observe(el, { childList: true, subtree: true })
    watchers.set(el, ob)
  },
  beforeUnmount(el) {
    watchers.get(el)?.disconnect()
    watchers.delete(el)
  }
}
