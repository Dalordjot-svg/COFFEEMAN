import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['mark.svg', 'icons/*.png'],
      manifest: {
        id: './',
        name: 'COFFEEMAN — Waiter System',
        short_name: 'COFFEEMAN',
        description: 'Рабочее приложение для официантов',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest}'],
      },
    }),
  ],
})
