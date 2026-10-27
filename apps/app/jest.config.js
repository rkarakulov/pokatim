const { transformIgnorePatterns } = require('jest-expo/jest-preset');

// часовой пояс тестов — явно: восточнее UTC и без перехода на летнее время, чтобы ловить сдвиг
// дат через toISOString() и не зависеть от сезона; pokatim — Europe/Minsk (AGENTS.md §4.7)
process.env.TZ = 'Europe/Minsk';

// список пресета jest-expo целиком + пакеты базы @rkarakulov/* (ESM) — их тоже транспилируем
const transpileBase = [
  transformIgnorePatterns[0].replace('(?!(', '(?!(@rkarakulov/|'),
  ...transformIgnorePatterns.slice(1),
];

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'native',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
      // *.web.test.* — web-проект ниже
      testPathIgnorePatterns: ['/node_modules/', '\\.web\\.test\\.'],
      // дизайн-система проекта и моки нативных модулей — общие для всех тестов
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      transformIgnorePatterns: transpileBase,
      // workspace-пакеты — из исходников, как в Metro
      testEnvironmentOptions: {
        customExportConditions: ['@pokatim/source', 'require', 'react-native'],
      },
    },
    {
      // web-варианты (*.web.ts(x)) в react-native-web и jsdom; маршруты в браузере — Playwright (e2e/)
      displayName: 'web',
      preset: 'jest-expo/web',
      testMatch: ['<rootDir>/src/**/*.web.test.{ts,tsx}'],
      setupFiles: ['<rootDir>/jest.match-media.web.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.web.ts'],
      transformIgnorePatterns: transpileBase,
      testEnvironmentOptions: {
        customExportConditions: ['@pokatim/source', 'browser'],
      },
    },
    {
      // web-сервер (server/), сборка (scripts/) и помощники смоука (e2e/): Node без рантайма React Native
      displayName: 'server',
      preset: 'jest-expo/node',
      testMatch: ['<rootDir>/{server,scripts,e2e}/**/*.test.ts'],
    },
  ],
};
