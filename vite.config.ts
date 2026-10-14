import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // fs.allow: the browser preview may read ../template (the reference workbooks) while testing.
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../template'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
