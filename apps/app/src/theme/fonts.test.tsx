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

describe('гарнитуры шести тем (слайс C)', () => {
  it('Атлас: display 600 — Manrope Bold, текст 400 — Manrope Regular', () => {
    const { families } = themeFonts(appThemes.atlas);
    expect(families.display[600]).toBe('Manrope_700Bold');
    expect(families.text[400]).toBe('Manrope_400Regular');
  });

  it('Хронометр: display 600 — Roboto Condensed Bold, текст — Inter', () => {
    const { families } = themeFonts(appThemes.chrono);
    expect(families.display[600]).toBe('RobotoCondensed_700Bold');
    expect(families.text[400]).toBe('Inter_400Regular');
  });

  it('наборы без дублей: у гарнитуры с двумя ролями — 4 файла, у «Inter + заголовочная» — 6', () => {
    expect(Object.keys(themeFonts(appThemes.atlas).assets)).toHaveLength(4);
    expect(Object.keys(themeFonts(appThemes.planner).assets)).toHaveLength(4);
    expect(Object.keys(themeFonts(appThemes.journal).assets)).toHaveLength(4);
    expect(Object.keys(themeFonts(appThemes.typography).assets)).toHaveLength(6);
  });

  it('всего подключено 24 файла: 6 прежних + 18 гарнитур тем', () => {
    expect(Object.keys(fontAssets)).toHaveLength(24);
  });
});
