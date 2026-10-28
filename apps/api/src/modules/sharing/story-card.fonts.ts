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

/** Начертание для satori: семейство — по роли (`display`/`text`), не по гарнитуре (Manrope в обеих ролях). */
export interface StoryCardFont {
  name: 'display' | 'text';
  weight: 500 | 600;
  data: Buffer;
  style: 'normal';
}

const files = new Map<FontFileId, Promise<Buffer>>();

/** Файл начертания — один раз на процесс (лениво, кэш промисов; сбой чтения не кэшируется). */
function load(id: FontFileId): Promise<Buffer> {
  let file = files.get(id);
  if (!file) {
    file = readFile(fontFilePath(id));
    files.set(id, file);
    file.catch(() => files.delete(id));
  }
  return file;
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
