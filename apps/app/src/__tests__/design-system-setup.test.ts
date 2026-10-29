/// <reference types="jest" />
// fs, path и __dirname — без типов Node (в мобилке их нет); jest исполняет тест в Node
declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');
const { join } = jest.requireActual<{ join(...paths: string[]): string }>('path');

// jest.setup.ts настраивает дизайн-систему для всех тестов, поэтому рендер её отсутствие в приложении не поймает:
// сторожим, что корневой layout импортирует настройку первой — до любого модуля с компонентами базы.
it('корневой layout первым импортирует настройку дизайн-системы', () => {
  const source = readFileSync(join(__dirname, '../app/_layout.tsx'), 'utf8');
  const firstImport = source.split('\n').find((line) => line.startsWith('import '));
  expect(firstImport).toBe("import '@/theme/design-system';");
});

// строгий CSP web (ADR-0025): zod `jitless` — до создания любой схемы, иначе проверка `new Function` нарушает CSP
it('настройка дизайн-системы первым импортирует zod jitless', () => {
  const source = readFileSync(join(__dirname, '../theme/design-system.ts'), 'utf8');
  const firstImport = source.split('\n').find((line) => line.startsWith('import '));
  expect(firstImport).toBe("import '@/features/web-security/zod-jitless';");
});
