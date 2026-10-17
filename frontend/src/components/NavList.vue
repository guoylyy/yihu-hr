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
.item { padding: 9px 12px; border-radius: var(--hr-radius); color: var(--hr-text); }
.item:hover { background: var(--hr-bg); }
.item.on { background: var(--hr-primary-soft); color: var(--hr-primary); font-weight: 600; }
</style>
