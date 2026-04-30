import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: {
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Live OCR Scanner',
        short_name: 'OCR Scan',
        description: 'Scannt Herstellerreferenzen von Paketen und sendet sie an Google Sheets',
        start_url: './',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#3b82f6',
        orientation: 'portrait',
        icons: [
          { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Matches Tesseract WASM, traineddata and worker scripts
            urlPattern: /(tesseract|eng\.traineddata|\.wasm)/,
            handler: 'CacheFirst',
            options: { cacheName: 'tesseract-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
});
