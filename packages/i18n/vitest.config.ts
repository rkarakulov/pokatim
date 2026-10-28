import { defineConfig } from 'vitest/config';

// исходники workspace-пакетов (@pokatim/*) напрямую, без сборки dist: node-тесты (ssr) и DOM-тесты (jsdom)
export default defineConfig({
  resolve: {
    conditions: ['@pokatim/source', 'module', 'browser', 'development|production'],
  },
  ssr: {
    resolve: { conditions: ['@pokatim/source', 'module', 'node', 'development|production'] },
  },
});
