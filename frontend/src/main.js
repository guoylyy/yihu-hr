import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import './styles.css'
import App from './App.vue'
import { router } from './router.js'
import { loadMe } from './me.js'

loadMe().catch(() => {}).finally(() => createApp(App).use(router).mount('#app'))
