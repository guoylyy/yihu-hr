<template>
  <nav class="nav">
    <template v-for="i in items" :key="i.to || i.group">
      <div v-if="i.group" class="group">{{ i.group }}</div>
      <router-link v-else :to="i.to" class="item" active-class="on" @click="$emit('go')">{{ i.label }}</router-link>
    </template>
  </nav>
</template>

<script setup>
// items：{ to, label } 是菜单项，{ group } 是分组标题
defineProps({ items: { type: Array, required: true } })
defineEmits(['go'])
</script>

<style scoped>
.nav { display: flex; flex-direction: column; padding: 4px 10px; gap: 2px; }
.group { padding: 12px 12px 4px; color: var(--hr-muted); font-size: 12px; }
.item { display: flex; align-items: center; min-height: 40px; padding: 0 12px; border-radius: var(--yh-radius-sm); color: var(--hr-text); }
.item:hover { background: var(--yh-hover); }
.item.on { background: var(--yh-nav-active-bg); color: var(--yh-nav-active-color); font-weight: 600; }
@media (max-width: 760px), (pointer: coarse) { .item { min-height: 44px; } }
</style>
