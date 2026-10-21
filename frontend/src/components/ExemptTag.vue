<template>
  <el-tag v-if="value" size="small" type="info" effect="plain" class="ex" :title="(note ? note + '：' : '') + EXEMPTION_HELP[value]" disable-transitions>{{ EXEMPTION_TAG[value] }}</el-tag>
</template>

<script setup>
// 考勤 / 考核豁免的小标签：名单、矩阵、画像里标在名字旁边，鼠标放上去看原因和影响
import { EXEMPTION_HELP, EXEMPTION_TAG } from '../labels.js'
defineProps({ value: String, note: String })
</script>

<style scoped>
.ex { margin-left: 6px; vertical-align: 1px; }
</style>
