import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 把 /api 请求转发到 Spring Boot 后端（server/），前端与后端同源，无需开启 CORS。
    proxy: {
      '/api': 'http://127.0.0.1:8081',
    },
  },
})
