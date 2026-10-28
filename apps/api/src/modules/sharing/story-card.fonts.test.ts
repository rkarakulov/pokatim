import { existsSync } from 'node:fs';

import { appThemes, fontFilesOf } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { fontFilePath, storyCardFonts } from './story-card.fonts';

describe('шрифты карточки', () => {
  it('начертания display/text 500/600 всех 7 тем — существующие .ttf', () => {
    for (const theme of Object.values(appThemes)) {
      const ids = [
        ...Object.values(fontFilesOf('display', theme.fonts.display)),
        ...Object.values(fontFilesOf('text', theme.fonts.text)),
      ];
      for (const id of ids) {
        const path = fontFilePath(id);
        expect(path.endsWith(`${id}.ttf`)).toBe(true);
        expect(existsSync(path)).toBe(true);
      }
    }
  });

  it('у satori — семейства по роли, 4 начертания (chrono: display 600 — файл 700)', async () => {
    const fonts = await storyCardFonts(appThemes.chrono);
    expect(fonts.map(({ name, weight }) => `${name}/${weight}`)).toEqual([
      'display/500',
      'display/600',
      'text/500',
      'text/600',
    ]);
    expect(fonts.every((font) => font.data.byteLength > 1000)).toBe(true);
  });
});
