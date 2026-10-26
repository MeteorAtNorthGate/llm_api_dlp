import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getThemeBootstrapScript } from './src/styles/themeRuntime.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'theme-before-paint',
      transformIndexHtml() {
        return [{ tag: 'script', children: getThemeBootstrapScript(), injectTo: 'head-prepend' }];
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api/': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
