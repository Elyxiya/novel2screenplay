import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    // 数据库相关测试统一使用独立测试库，避免污染真实 data/novel2screenplay.db
    env: {
      DB_DIR: 'data-test',
      DB_FILE: 'test.db',
    },
    // SQLite 单文件多 worker 并发会互相干扰，串行执行保证确定性
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx'],
    },
  },
  resolve: {
    alias: [
      { find: '@novel/contracts', replacement: path.resolve(__dirname, '../../packages/contracts/dist') },
      { find: '@novel/auth', replacement: path.resolve(__dirname, '../../packages/auth/dist') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
