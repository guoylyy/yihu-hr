<template>
  <div class="page">
    <div class="page-head"><h2>设置</h2></div>
    <el-tabs v-model="tab">
      <el-tab-pane label="打卡同步" name="sync" lazy><SyncTab /></el-tab-pane>
      <el-tab-pane label="规则" name="rules" lazy><RulesTab /></el-tab-pane>
      <el-tab-pane label="假期类型" name="types" lazy><TypesTab /></el-tab-pane>
      <el-tab-pane label="节假日" name="holidays" lazy><HolidaysTab /></el-tab-pane>
      <el-tab-pane label="人事成员" name="hr" lazy><HrTab /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import SyncTab from './settings/SyncTab.vue'
import RulesTab from './settings/RulesTab.vue'
import TypesTab from './settings/TypesTab.vue'
import HolidaysTab from './settings/HolidaysTab.vue'
import HrTab from './settings/HrTab.vue'

const tab = ref('sync')
</script>
