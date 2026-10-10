import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE = "/<repo-name>/" for a GitHub project page. Defaults to "/sfe-hub/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/sfe-hub/',
  plugins: [react()],
})
