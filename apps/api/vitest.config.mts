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
    // потоки разбора трека (`worker_threads`, tracks-devices) наследуют execArgv: `@pokatim/tracks/parse` — из
    // исходников пакета, как у vite (условие `@pokatim/source`)
    execArgv: ['--conditions=@pokatim/source'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.int.test.ts'],
          sequence: { groupOrder: 0 },
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
          // после unit, а не вместе с ним: unit занимает все ядра (разбор треков 200 000 точек, OG, аватар 48 Мп), и
          // последовательные int-тесты в это время шли в разы медленнее — таймауты 20 с под нагрузкой (flaky-tests)
          sequence: { groupOrder: 1 },
          // честно тяжёлые: настоящие транзакции replica set и разбор треков в `worker_threads` (холодный старт потока
          // 0,5–1,3 с под нагрузкой, несколько разборов на тест); при load ≈ 50 (параллельные прогоны веток) — до 35 с
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
