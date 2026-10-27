/// <reference types="jest" />
import { appThemes, typography, type TextStyleName } from '@pokatim/design-tokens';
import { textStyle, ThemeProvider } from '@rkarakulov/ui';
import { render } from '@testing-library/react-native';

import { fontAssets, themeFonts, type ThemeFontSet } from './fonts';

// дизайн-система настроена брендом проекта в jest.setup.ts (src/theme/design-system.ts)
describe('шрифты проекта в дизайн-системе', () => {
  it('каждый стиль typography разрешается в подключённый шрифт', () => {
    for (const name of Object.keys(typography) as TextStyleName[]) {
      expect(Object.keys(fontAssets)).toContain(textStyle(name).fontFamily);
    }
  });

  it('вес — своим файлом: заголовок 500 — Playfair Display Medium, текст 400 — Inter Regular', () => {
    expect(textStyle('displayTitle').fontFamily).toBe('PlayfairDisplay_500Medium');
    expect(textStyle('body').fontFamily).toBe('Inter_400Regular');
  });
});

describe('шрифты тем приложения', () => {
  const families = (set: ThemeFontSet) => [
    ...Object.values(set.families.display),
    ...Object.values(set.families.text),
  ];

  it.each(Object.values(appThemes))(
    '$id: семейства — подключённые файлы, грузится ровно их набор',
    (def) => {
      const set = themeFonts(def);
      expect(Object.keys(fontAssets)).toEqual(expect.arrayContaining(families(set)));
      expect(Object.keys(set.assets).sort()).toEqual([...new Set(families(set))].sort());
      expect(themeFonts(def)).toBe(set);
    },
  );

  it.each(Object.values(appThemes))(
    '$id: textStyle под ThemeProvider темы разрешается в подключённый файл',
    async (def) => {
      const resolved: string[] = [];
      function Probe() {
        for (const name of Object.keys(typography) as TextStyleName[]) {
          resolved.push(String(textStyle(name).fontFamily));
        }
        return null;
      }
      await render(
        <ThemeProvider theme={def.schemes.light} fonts={themeFonts(def).families}>
          <Probe />
        </ThemeProvider>,
      );
      expect(resolved.length).toBeGreaterThan(0);
      expect(Object.keys(themeFonts(def).assets)).toEqual(expect.arrayContaining(resolved));
    },
  );
});
