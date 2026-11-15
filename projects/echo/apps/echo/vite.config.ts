import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5000,
    host: '0.0.0.0',
    allowedHosts: true,
    // 本地由 Express 托管，固定 HMR 端口会和同机其他 ECHO 实例冲突
    hmr: false,
    watch: {
      usePolling: true,
      interval: 100,
    }
  },
});
