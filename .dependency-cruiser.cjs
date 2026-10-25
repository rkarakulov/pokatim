// Границы архитектуры. Ratchet: error-правила должны давать 0 нарушений.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'packages-not-import-apps',
      comment: 'packages/* — общие библиотеки, они не знают о приложениях',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-isolated',
      comment: 'Приложения не импортируют друг друга, общее — через packages/*',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-public-api-only',
      comment: 'Импорт пакета только через его точку входа (src/index.ts), без deep imports',
      severity: 'error',
      from: { pathNot: '^packages/([^/]+)/' },
      // src/parse.ts — второй вход @pokatim/tracks (`@pokatim/tracks/parse`, парсеры только для worker API)
      to: { path: '^packages/[^/]+/src/(?!(index|parse)\\.ts$)' },
    },
    {
      name: 'api-module-public-api-only',
      comment: 'Модуль API импортирует другой модуль только через его index.ts',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/(?!index\\.ts$)',
        pathNot: '^apps/api/src/modules/$1/',
      },
    },
    {
      name: 'contracts-pure',
      comment:
        'contracts — только zod и ядро контрактов базы (чистый zod), без runtime-зависимостей фреймворков',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { dependencyTypes: ['npm'], pathNot: 'node_modules/(zod|@rkarakulov/contracts-core)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|\\.expo|\\.turbo|drizzle/meta)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
