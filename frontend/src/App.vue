<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">人事考勤</div>
      <NavList :items="items" />
      <div class="who">
        <span>{{ me.user?.name || '未登录' }}<span v-if="me.hr" class="role">人事</span></span>
        <a href="logout" class="logout" title="退出后可以在平台换个账号登录">退出</a>
      </div>
    </aside>
    <header class="top">
      <el-button text @click="drawer = true"><el-icon size="20"><Menu /></el-icon></el-button>
      <span class="brand">人事考勤</span>
      <span class="who-top">{{ me.user?.name }}</span>
    </header>
    <el-drawer v-model="drawer" direction="ltr" size="220px" :with-header="false">
      <NavList :items="items" @go="drawer = false" />
      <a href="logout" class="logout drawer-logout">退出（{{ me.user?.name }}）</a>
    </el-drawer>
    <main class="main">
      <div v-if="!me.loaded" class="page muted">加载失败，请刷新重试</div>
      <router-view v-else />
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Menu } from '@element-plus/icons-vue'
import NavList from './components/NavList.vue'
import { me } from './me.js'

const drawer = ref(false)
const items = computed(() => [
  { to: '/my', label: '我的考勤' },
  { to: '/leave', label: '请假' },
  ...(me.approver || me.hr ? [{ to: '/approvals', label: '审批' }] : []),
  ...(me.team ? [{ to: '/team', label: '团队考勤' }, { to: '/report', label: '月度报表' }] : []),
  ...(me.hr ? [{ to: '/balances', label: '假期余额' }, { to: '/settings', label: '设置' }] : [])
])
</script>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side { width: 200px; flex: none; background: var(--hr-surface); border-right: 1px solid var(--hr-border); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
.brand { font-weight: 600; font-size: 16px; padding: 18px 20px; color: var(--hr-primary); }
.who { margin-top: auto; padding: 14px 20px; border-top: 1px solid var(--hr-border); color: var(--hr-muted); font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.logout { color: var(--hr-muted); text-decoration: none; font-size: 13px; }
.logout:hover { color: var(--hr-primary); }
.drawer-logout { display: block; margin-top: 16px; padding: 10px 12px; border-top: 1px solid var(--hr-border); }
.role { margin-left: 6px; font-size: 11px; padding: 1px 6px; border-radius: 8px; background: var(--hr-primary-soft); color: var(--hr-primary); }
.top { display: none; }
.main { flex: 1; min-width: 0; }
@media (max-width: 760px) {
  .shell { flex-direction: column; }
  .side { display: none; }
  .top { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--hr-surface); border-bottom: 1px solid var(--hr-border); position: sticky; top: 0; z-index: 10; }
  .top .brand { padding: 0; }
  .who-top { margin-left: auto; padding-right: 8px; color: var(--hr-muted); font-size: 13px; }
}
</style>
