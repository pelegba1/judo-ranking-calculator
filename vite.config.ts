import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  base: './',
  publicDir: '../../public',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
});
