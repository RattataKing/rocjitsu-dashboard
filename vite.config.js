import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          if (moduleId.includes('/node_modules/zrender/')) return 'chart-renderer';
          if (moduleId.includes('/node_modules/echarts/')) return 'charts';
          if (moduleId.includes('/node_modules/@mui/') || moduleId.includes('/node_modules/@emotion/')) return 'ui';
          if (moduleId.includes('/node_modules/react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
