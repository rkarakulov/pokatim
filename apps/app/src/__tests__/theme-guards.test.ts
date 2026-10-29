/// <reference types="jest" />
import { TAB_NAMES } from '@/components/tab-bar';

// fs, path и __dirname — без типов Node (в мобилке их нет); jest исполняет тест в Node
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
}>('fs');
const { join, relative } = jest.requireActual<{
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
}>('path');

const SRC = join(__dirname, '..');

/** Ветвление по теме: сравнение с id темы (в любом порядке и любых кавычках) и со значением `layout`, `switch` по нему. */
const THEME_BRANCHING = (ids: string) => [
  new RegExp(`[!=]==\\s*['"](${ids})['"]`),
  new RegExp(`['"](${ids})['"]\\s*[!=]==`),
  /layout\.\w+\s*[!=]==/,
  /[!=]==\s*[\w.]*layout\.\w+/,
  /switch\s*\(\s*[\w.()]*layout\.\w+/,
];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const offenders = (pattern: RegExp, allowed: string[] = []) =>
  sources(SRC)
    .map((path) => relative(SRC, path))
    .filter((path) => !allowed.includes(path))
    .filter((path) => pattern.test(fs.readFileSync(join(SRC, path), 'utf8')));

// AC3 app-themes: оформление — из активной темы (ADR-0016)
describe('темы приложения — сторож кода', () => {
  it('нет выбора схемы по объекту темы (themes.light/dark, === themes.)', () => {
    expect(offenders(/themes\.(light|dark)\b|===\s*themes\./)).toEqual([]);
  });

  it('expo-symbols — только через Icon', () => {
    expect(offenders(/from 'expo-symbols'|SymbolView/, ['components/icon.tsx'])).toEqual([]);
  });

  it('шрифты — только useThemeFonts (useFonts expo-font не перезагружает карту при смене темы)', () => {
    expect(offenders(/\buseFonts\s*\(|import \{[^}]*\buseFonts\b/)).toEqual([]);
  });

  it('варианты раскладки — таблицами Record, без сравнений id темы и значения layout (app-themes C2)', () => {
    const themeIds = 'classic|atlas|chrono|planner|journal|navigation|typography';
    for (const pattern of THEME_BRANCHING(themeIds)) expect(offenders(pattern)).toEqual([]);
  });

  it('сторож ловит все записи сравнения (самопроверка шаблонов)', () => {
    const caught = (code: string) =>
      THEME_BRANCHING('classic|atlas|chrono|planner|journal|navigation|typography').some((p) =>
        p.test(code),
      );
    for (const code of [
      "if (id === 'atlas')",
      'if (themeId !== "chrono")',
      "if ('typography' === def.id)",
      'switch (layout.home) {',
      'switch (theme.layout.tabBar) {',
      "if (layout.routeCard === 'tile')",
      "if ('tile' === layout.routeCard)",
      'x !== theme.layout.home',
    ]) {
      expect(caught(code)).toBe(true);
    }
    expect(caught('const Hero = ROUTE_HERO[useAppTheme().layout.home];')).toBe(false);
  });

  it('таб-бар: у каждой вкладки (tabs)/_layout есть иконка варианта icons', () => {
    const layout = fs.readFileSync(join(SRC, 'app', '(tabs)', '_layout.tsx'), 'utf8');
    const screens = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1]);
    expect(screens.length).toBeGreaterThan(0);
    expect([...TAB_NAMES].sort()).toEqual([...screens].sort());
  });

  it('React Compiler выключен: textStyle() читает шрифты темы из модуля — кэш компилятора оставил бы прежние (user-theme)', () => {
    const appJson = JSON.parse(fs.readFileSync(join(SRC, '..', 'app.json'), 'utf8')) as {
      expo: { experiments?: { reactCompiler?: boolean } };
    };
    expect(appJson.expo.experiments?.reactCompiler).not.toBe(true);
  });
});
