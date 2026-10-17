import { createRouter, createWebHashHistory } from 'vue-router'
import { me } from './me.js'

const routes = [
  // 默认页：人事和负责人进人员全景，其他人进我的考勤（me 在挂载路由前已经加载好）
  { path: '/', redirect: () => (me.team ? '/people' : '/my') },
  { path: '/my', component: () => import('./views/MyAttendance.vue'), meta: { title: '我的考勤' } },
  { path: '/leave', component: () => import('./views/Leave.vue'), meta: { title: '请假' } },
  { path: '/approvals', component: () => import('./views/Approvals.vue'), meta: { title: '审批' } },
  { path: '/team', component: () => import('./views/Team.vue'), meta: { title: '团队考勤', need: 'team' } },
  { path: '/report', component: () => import('./views/Report.vue'), meta: { title: '月度报表', need: 'team' } },
  { path: '/people', component: () => import('./views/People.vue'), meta: { title: '人员全景', need: 'team' } },
  { path: '/people/:id', component: () => import('./views/Person.vue'), meta: { title: '人员画像' } },
  { path: '/contracts', component: () => import('./views/Contracts.vue'), meta: { title: '合同', need: 'contracts' } },
  { path: '/costs', component: () => import('./views/Costs.vue'), meta: { title: '人员成本', need: 'cost' } },
  { path: '/one-on-ones', component: () => import('./views/OneOnOnes.vue'), meta: { title: '1v1' } },
  { path: '/balances', component: () => import('./views/Balances.vue'), meta: { title: '假期余额', need: 'hr' } },
  { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '设置', need: 'hr' } },
  { path: '/:p(.*)*', redirect: '/' }
]

export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  if (to.meta.need && me.loaded && !me[to.meta.need]) return '/my'
})
router.afterEach((to) => { document.title = `${to.meta.title ? to.meta.title + ' · ' : ''}人事考勤` })
