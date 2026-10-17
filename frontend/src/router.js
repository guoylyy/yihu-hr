import { createRouter, createWebHashHistory } from 'vue-router'
import { me } from './me.js'

const routes = [
  { path: '/', redirect: '/my' },
  { path: '/my', component: () => import('./views/MyAttendance.vue'), meta: { title: '我的考勤' } },
  { path: '/leave', component: () => import('./views/Leave.vue'), meta: { title: '请假' } },
  { path: '/approvals', component: () => import('./views/Approvals.vue'), meta: { title: '审批' } },
  { path: '/team', component: () => import('./views/Team.vue'), meta: { title: '团队考勤', need: 'team' } },
  { path: '/report', component: () => import('./views/Report.vue'), meta: { title: '月度报表', need: 'team' } },
  { path: '/balances', component: () => import('./views/Balances.vue'), meta: { title: '假期余额', need: 'hr' } },
  { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '设置', need: 'hr' } },
  { path: '/:p(.*)*', redirect: '/my' }
]

export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  if (to.meta.need && me.loaded && !me[to.meta.need]) return '/my'
})
router.afterEach((to) => { document.title = `${to.meta.title ? to.meta.title + ' · ' : ''}人事考勤` })
