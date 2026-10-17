import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // 资源用相对路径：装在以虎 One 的 /apps/hr/ 下也能用
  base: './',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] })
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // Element Plus 整包约 900KB（gzip 300KB），单独成块、浏览器缓存
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(element-plus|@element-plus)\//.test(id)) return 'vendor-element'
          if (/node_modules\/(vue|@vue|vue-router)\//.test(id)) return 'vendor-vue'
        }
      }
    }
  },
  server: {
    port: 5186,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3006', changeOrigin: true }
    }
  }
})
