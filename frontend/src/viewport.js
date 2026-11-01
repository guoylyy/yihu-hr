// 窄屏判断：和 styles.css 里的 760px 断点保持一致
import { ref } from 'vue'

const query = window.matchMedia('(max-width: 760px)')
export const isMobile = ref(query.matches)
query.addEventListener('change', (e) => { isMobile.value = e.matches })
