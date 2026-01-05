import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin(), tailwindcss()],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
    // Optimize for low-memory ARM builds
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
