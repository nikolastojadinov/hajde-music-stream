import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend', 'src'),
    },
  },
  server: {
    port: 8080,
  },
  build: {
    outDir: path.resolve(__dirname, 'frontend', 'build'),
    emptyOutDir: true,
  },
});
