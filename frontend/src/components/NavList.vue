<template>
  <nav class="nav">
    <router-link v-for="i in items" :key="i.to" :to="i.to" class="item" active-class="on" @click="$emit('go')">{{ i.label }}</router-link>
  </nav>
</template>

<script setup>
defineProps({ items: { type: Array, required: true } })
defineEmits(['go'])
</script>

<style scoped>
.nav { display: flex; flex-direction: column; padding: 4px 10px; gap: 2px; }
.item { padding: 9px 12px; border-radius: var(--hr-radius); color: var(--hr-text); }
.item:hover { background: var(--hr-bg); }
.item.on { background: var(--hr-primary-soft); color: var(--hr-primary); font-weight: 600; }
</style>
