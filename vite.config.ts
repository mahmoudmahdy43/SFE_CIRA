import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE = "/<repo-name>/" for a GitHub project page. Defaults to "/sfe-hub/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/sfe-hub/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
