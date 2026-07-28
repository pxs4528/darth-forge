import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [
    solidPlugin({
      dev: false, // Disable all dev-only features
      hot: false, // Disable hot module replacement
    }),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    // Route API calls to the Go backend in dev (prod uses Caddy for this).
    proxy: {
      '/api': 'http://localhost:8080',
    },
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
