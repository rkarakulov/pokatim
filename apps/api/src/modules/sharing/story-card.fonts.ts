import { readFile } from 'node:fs/promises';

import { type AppThemeDefinition, fontFilesOf, type FontFileId } from '@pokatim/design-tokens';

/** Префикс id файла → пакет `@expo-google-fonts/<пакет>` (файлы — `<пакет>/<ВесИмя>/<id>.ttf`). */
const FONT_PACKAGES: Readonly<Record<string, string>> = {
  GolosText: 'golos-text',
  Inter: 'inter',
  InterTight: 'inter-tight',
  Manrope: 'manrope',
  Onest: 'onest',
  Oswald: 'oswald',
  PlayfairDisplay: 'playfair-display',
  RobotoCondensed: 'roboto-condensed',
};

/** Путь `.ttf` начертания (satori не читает WOFF2); незнакомый префикс — ошибка. */
export function fontFilePath(id: FontFileId): string {
  const [family, weight] = id.split('_') as [string, string];
  const pkg = FONT_PACKAGES[family];
  if (!pkg) throw new Error(`story card fonts: no package for ${id}`);
  return require.resolve(`@expo-google-fonts/${pkg}/${weight}/${id}.ttf`);
}

/**
 * Начертание для satori: семейство — по роли (`display`/`text`), не по гарнитуре (Manrope в обеих ролях); `symbols` —
 * иконки (Material Symbols, карточка достижения).
 */
export interface StoryCardFont {
  name: 'display' | 'text' | 'symbols';
  weight: 400 | 500 | 600;
  data: Buffer;
  style: 'normal';
}

const files = new Map<string, Promise<Buffer>>();

/** Файл — один раз на процесс (лениво, кэш промисов; сбой чтения не кэшируется). */
function loadFile(path: string): Promise<Buffer> {
  let file = files.get(path);
  if (!file) {
    file = readFile(path);
    files.set(path, file);
    file.catch(() => files.delete(path));
  }
  return file;
}

const load = (id: FontFileId) => loadFile(fontFilePath(id));

/**
 * Шрифт иконок — Material Symbols 400 (тот же пакет, которым `expo-symbols` рисует иконки приложения на Android и web);
 * глиф — по кодовой точке (`achievement-card.icons.ts`), без лигатур.
 */
export async function symbolsFont(): Promise<StoryCardFont> {
  const path =
    require.resolve('@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.ttf');
  return { name: 'symbols', weight: 400, data: await loadFile(path), style: 'normal' };
}

/** 4 начертания темы: display 500/600, text 500/600 (`appFontFaces`). */
export async function storyCardFonts(theme: AppThemeDefinition): Promise<StoryCardFont[]> {
  const display = fontFilesOf('display', theme.fonts.display);
  const text = fontFilesOf('text', theme.fonts.text);
  const faces = [
    { name: 'display', weight: 500, id: display[500] },
    { name: 'display', weight: 600, id: display[600] },
    { name: 'text', weight: 500, id: text[500] },
    { name: 'text', weight: 600, id: text[600] },
  ] as const;
  return Promise.all(
    faces.map(async ({ name, weight, id }) => ({
      name,
      weight,
      data: await load(id),
      style: 'normal' as const,
    })),
  );
}
