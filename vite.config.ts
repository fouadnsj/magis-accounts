import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // fs.allow: the browser preview may read ../template (the reference workbooks) while testing.
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../template'] } },
  // two pages: the program, and the small phone page (kept by the phone to work with no connection)
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: 'index.html', phone: 'phone.html' } } },
});
