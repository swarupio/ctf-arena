import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '..',
  envPrefix: 'VITE_',
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
