import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Relative paths for GitHub Pages
  server: {
    port: 5173,
    open: true
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    outDir: 'dist'
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    include: [
      'maplibre-gl'
    ]
  }
});
