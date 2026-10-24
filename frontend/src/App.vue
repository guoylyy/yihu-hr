<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">人事考勤<span v-if="me.version" class="ver" title="人事考勤的版本，更新说明见 CHANGELOG">v{{ me.version }}</span></div>
      <NavList :items="items" />
      <div class="who">
        <span>{{ me.user?.name || '未登录' }}<span v-if="me.hr" class="role">人事</span></span>
        <span class="acts">
          <a href="logout?switch=1" class="logout" title="退出以虎 One 的登录，换个账号登录后回到这里">换账号</a>
          <a href="logout" class="logout" title="回以虎 One 工作台（不退出平台登录）">退出</a>
        </span>
      </div>
    </aside>
    <header class="top">
      <el-button text @click="drawer = true"><el-icon size="20"><Menu /></el-icon></el-button>
      <span class="brand">人事考勤</span>
      <span class="who-top">{{ me.user?.name }}</span>
    </header>
    <el-drawer v-model="drawer" direction="ltr" size="220px" :with-header="false">
      <NavList :items="items" @go="drawer = false" />
      <div v-if="me.version" class="muted small" style="padding: 10px 12px 0">人事考勤 v{{ me.version }}</div>
      <a href="logout" class="logout drawer-logout">退出，回工作台（{{ me.user?.name }}）</a>
      <a href="logout?switch=1" class="logout drawer-logout" style="margin-top: 0; border-top: none">换账号</a>
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
  // 人员全景放最上面（人事和负责人登录后默认也进这里）
  ...(me.team ? [{ to: '/people', label: '人员全景' }, { to: '/advisor', label: '分析建议' }] : []),
  { group: '考勤' },
  { to: '/my', label: '我的考勤' },
  { to: '/leave', label: '我的假期' },
  ...(me.team ? [{ to: '/team', label: '团队考勤' }] : []),
  { group: '人员' },
  { to: '/people/me', label: '我的档案' },
  { to: '/one-on-ones', label: '1v1' },
  ...(me.contracts ? [{ to: '/contracts', label: '合同' }] : []),
  ...(me.cost ? [{ to: '/costs', label: '人员成本' }] : []),
  ...(me.hr ? [{ group: '管理' }, { to: '/import', label: '智能导入' }, { to: '/balances', label: '假期余额' }, { to: '/settings', label: '设置' }] : [])
])
</script>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side { width: 200px; flex: none; background: var(--hr-surface); border-right: 1px solid var(--hr-border); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
.brand { font-weight: 600; font-size: 16px; padding: 18px 20px; color: var(--hr-primary); }
.ver { margin-left: 6px; font-size: 11px; font-weight: normal; color: var(--hr-muted); }
.who { margin-top: auto; padding: 14px 20px; border-top: 1px solid var(--hr-border); color: var(--hr-muted); font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.logout { color: var(--hr-muted); text-decoration: none; font-size: 13px; }
.logout:hover { color: var(--hr-primary); }
.acts { display: flex; gap: 10px; flex: none; }
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
