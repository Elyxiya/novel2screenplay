import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // SQLite 内存库在单 worker 内串行执行，保证确定性
    fileParallelism: false,
  },
});
