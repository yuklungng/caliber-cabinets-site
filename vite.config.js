/* global process */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build stamp shown (tiny) in the admin panel corner. On Vercel the commit comes
// from VERCEL_GIT_COMMIT_SHA; locally it falls back to git, then 'dev'.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
function buildCommit() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(buildCommit()),
    'import.meta.env.VITE_APP_BUILD_DATE': JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    // Disable sourcemaps in production — they expose source code and roughly double JS file weight.
    // React.lazy() in App.jsx handles automatic code splitting for AdminPage.
    sourcemap: false,
  },
});
