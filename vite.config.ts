import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Root-level Vite config that points to frontend directory
export default defineConfig(() => {
  const frontendRoot = path.resolve(__dirname, 'frontend');
  
  return {
    root: __dirname,
    publicDir: path.resolve(frontendRoot, 'public'),
    base: './',
    server: {
      host: '::',
      port: 8080,
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.resolve(frontendRoot, 'tailwind.config.ts') }), 
          autoprefixer()
        ],
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
