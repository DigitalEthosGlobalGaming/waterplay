import { defineConfig } from 'vitest/config';
import { buildIdPlugin } from './tools/vite-build-id.ts';

export default defineConfig({
  plugins: [buildIdPlugin('test')],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
