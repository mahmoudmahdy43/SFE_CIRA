import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function gitSha(): string {
  const env = process.env.GITHUB_SHA
  if (env) return env.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const BUILD_SHA = gitSha()
const BUILD_TIME = new Date().toISOString()

/** Emits version.json next to index.html so a running tab can detect a newer deploy. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ sha: BUILD_SHA, time: BUILD_TIME }) })
    },
  }
}

// VITE_BASE = "/<repo-name>/" for a GitHub project page. Defaults to "/sfe-hub/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/sfe-hub/',
  plugins: [react(), versionFile()],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
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
