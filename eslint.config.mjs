// Единый ESLint flat config монорепо (запускается из корня: pnpm lint) — пресет базы app-foundation
import { createEslintConfig } from '@rkarakulov/config/eslint';

// корни @rkarakulov/api-kit и @rkarakulov/test-kit — PostgreSQL (pg, drizzle-orm): в проекте на MongoDB их нет,
// импорт падает только в рантайме (typecheck со skipLibCheck не ловит) — только /core и /mongo
const POSTGRES_ROOTS = ['@rkarakulov/api-kit', '@rkarakulov/test-kit'].map((name) => ({
  name,
  message: `${name} — вход PostgreSQL; в проекте на MongoDB — ${name}/core и ${name}/mongo`,
}));

const preset = await createEslintConfig({
  // dist-dev и отчёты Playwright — артефакты web-сборки и e2e
  ignores: ['apps/app/dist-dev/**', 'apps/app/test-results/**', 'apps/app/playwright-report/**'],
  reactNative: ['apps/app/**/*.{ts,tsx,js}'],
  browser: ['apps/admin/**/*.{ts,tsx}'],
  nest: ['apps/api/**/*.ts'],
  // цвета — только роли темы (useTheme / CSS-переменные бренда), палитра — только в темах бренда
  designSystemOnly: ['apps/{app,admin}/src/**/*.{ts,tsx}'],
  paletteModules: ['@rkarakulov/design-tokens'],
});

export default [
  ...preset,
  {
    files: ['apps/api/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: POSTGRES_ROOTS }] },
  },
];
