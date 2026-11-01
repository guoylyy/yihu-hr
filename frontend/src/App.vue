<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <!-- 以虎官方图标 hr（yihu-brand），强调色固定不跟主题 -->
        <svg class="brand-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.75 7.125a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0 -6.5 0Z"/><path d="M4.5 20.125a7.5 6.375 0 0 1 15 0M4 20.125h16"/><path d="M10.75 7.125a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0Z" fill="#d2521e" stroke="none"/></svg>
        人事考勤
      </div>
      <div class="right">
        <span v-if="me.version && !isMobile" class="ver" title="人事考勤的版本，更新说明见 CHANGELOG">v{{ me.version }}</span>
        <button v-if="isMobile" class="avatar-btn" aria-label="菜单" @click="drawer = true"><el-avatar :size="32" :src="me.user?.avatar || undefined">{{ initial }}</el-avatar></button>
        <el-dropdown v-else trigger="click">
          <button class="avatar-btn" aria-label="账号菜单"><el-avatar :size="32" :src="me.user?.avatar || undefined">{{ initial }}</el-avatar></button>
          <template v-slot:dropdown>
            <div class="menu-who">{{ me.user?.name || '未登录' }}<span v-if="me.hr" class="role">人事</span></div>
            <el-dropdown-menu>
              <el-dropdown-item v-if="me.hr" @click="router.push('/settings')">设置</el-dropdown-item>
              <el-dropdown-item @click="router.push('/about')">关于</el-dropdown-item>
              <el-dropdown-item divided @click="logout">退出</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>
    <div class="body">
      <aside class="side"><NavList :items="items" /></aside>
      <main class="main">
        <div v-if="!me.loaded" class="page muted">加载失败，请刷新重试</div>
        <router-view v-else />
      </main>
    </div>
    <!-- 窄屏顶栏只留应用名和头像：导航、版本都收进这里 -->
    <el-drawer v-model="drawer" direction="rtl" size="260px" :with-header="false">
      <div class="menu-who">{{ me.user?.name || '未登录' }}<span v-if="me.hr" class="role">人事</span></div>
      <NavList :items="items" @go="drawer = false" />
      <div class="drawer-menu">
        <router-link to="/about" class="drawer-item">关于</router-link>
        <a :href="LOGOUT" class="drawer-item">退出</a>
        <div v-if="me.version" class="muted small drawer-ver">版本 v{{ me.version }}</div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavList from './components/NavList.vue'
import { me } from './me.js'
import { isMobile } from './viewport.js'

// 先清本应用的会话，再由后端 302 到平台的 /logout?redirect=/apps/hr/（平台也退出，重新登录后回到这里）
const LOGOUT = 'logout?switch=1'
const logout = () => { window.location.href = LOGOUT }

const route = useRoute()
const router = useRouter()
const drawer = ref(false)
watch(() => route.fullPath, () => { drawer.value = false })
const initial = computed(() => [...(me.user?.name || '我')][0])
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
.shell { display: flex; flex-direction: column; min-height: 100vh; }
.top { height: calc(var(--yh-header-h) + env(safe-area-inset-top)); padding: env(safe-area-inset-top) 20px 0; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--hr-surface); border-bottom: 1px solid var(--hr-border); position: sticky; top: 0; z-index: 10; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 16px; color: var(--hr-text); white-space: nowrap; }
.brand-icon { flex: none; }
.right { display: flex; align-items: center; gap: 12px; flex: none; }
.ver { font-size: 12px; color: var(--hr-muted); font-family: var(--yh-font-num); font-variant-numeric: tabular-nums; }
.avatar-btn { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 50%; }
.avatar-btn :deep(.el-avatar) { background: var(--hr-primary); color: var(--hr-on-primary); font-weight: 600; }
.menu-who { padding: 10px 16px; color: var(--hr-muted); font-size: 13px; border-bottom: 1px solid var(--hr-border); white-space: nowrap; }
.role { margin-left: 6px; font-size: 11px; padding: 1px 6px; border-radius: var(--yh-radius-sm); background: var(--hr-primary-soft); color: var(--hr-primary); }
.body { display: flex; flex: 1; min-height: 0; }
.side { width: var(--yh-sidebar-w); flex: none; background: var(--yh-sidebar); border-right: 1px solid var(--hr-border); position: sticky; top: var(--yh-header-h); height: calc(100vh - var(--yh-header-h)); overflow-y: auto; padding-top: 8px; }
.main { flex: 1; min-width: 0; }
.drawer-menu { margin-top: 8px; padding: 8px 10px; border-top: 1px solid var(--hr-border); display: flex; flex-direction: column; gap: 2px; }
.drawer-item { display: flex; align-items: center; min-height: 44px; padding: 0 12px; color: var(--hr-text); }
.drawer-ver { padding: 10px 12px 0; }
@media (max-width: 760px) {
  .top { padding-left: 16px; padding-right: 8px; }
  .side { display: none; }
}
</style>
