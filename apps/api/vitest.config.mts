import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен для emitDecoratorMetadata — без него DI NestJS в тестах не работает
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  // своё условие + стандартные серверные условия Vite (иначе они затираются)
  ssr: {
    resolve: { conditions: ['@pokatim/source', 'module', 'node', 'development|production'] },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.int.test.ts'],
        },
      },
      {
        // реальные MongoDB (replica set, pokatim_test) и Redis (db 1); файлы — по очереди, общая БД
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
