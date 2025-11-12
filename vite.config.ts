import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'frontend'),
  base: './',
  server: {
    host: '::',
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend', 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'frontend', 'build'),
    emptyOutDir: true,
  },
}));
