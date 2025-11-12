import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Vite config that points root to the repo root, and outputs to /frontend/build
export default defineConfig(() => {
  const frontendRoot = __dirname;
  return {
    root: frontendRoot,
    base: './',
    server: {
      host: '::',
      port: 8080,
    },
    css: {
      postcss: {
        plugins: [tailwindcss({ config: path.resolve(frontendRoot, 'tailwind.config.ts') }), autoprefixer()],
      },
    },
    build: {
      outDir: path.resolve(frontendRoot, 'build'),
      emptyOutDir: true,
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(frontendRoot, 'src'),
      },
    },
  };
});
