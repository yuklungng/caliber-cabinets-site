import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Disable sourcemaps in production — they expose source code and roughly double JS file weight.
    // React.lazy() in App.jsx handles automatic code splitting for AdminPage.
    sourcemap: false,
  },
});
