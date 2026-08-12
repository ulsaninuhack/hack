import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022', sourcemap: true },
})
