/// <reference types="jest" />
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
});
