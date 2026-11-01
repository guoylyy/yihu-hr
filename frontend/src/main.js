import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import './yh-vi.css'
import './styles.css'
import App from './App.vue'
import { router } from './router.js'
import { loadMe } from './me.js'
import { cardList } from './cardList.js'

loadMe().catch(() => {}).finally(() => createApp(App).use(router).directive('card-list', cardList).mount('#app'))
