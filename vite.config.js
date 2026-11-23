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

// pdf.js decodes some catalog pictures (JPEG 2000, JBIG2) and colour profiles with WebAssembly files it fetches by
// name from one folder (catalogReader.js passes wasmUrl: '/pdfjs/'). Served from node_modules in dev and copied into
// the build, so the files are not kept in the repo.
const PDFJS_WASM = ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm'];
const pdfjsWasmDir = new URL('./node_modules/pdfjs-dist/wasm/', import.meta.url);
function pdfjsWasm() {
  return {
    name: 'pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/pdfjs\/([\w.-]+\.wasm)(\?|$)/)?.[1];
        if (!name || !PDFJS_WASM.includes(name)) return next();
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(new URL(name, pdfjsWasmDir)));
      });
    },
    generateBundle() {
      for (const name of PDFJS_WASM) this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(new URL(name, pdfjsWasmDir)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsWasm()],
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
