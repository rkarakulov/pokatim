import { space, type FontStack } from '@rkarakulov/design-tokens';

import * as palettes from './app-theme-palettes.ts';
import { font, fontStack, themes, type AppTheme } from './brand.ts';

/**
 * Темы приложения райдера (ADR-0016). Тот же состав и порядок, что `APP_THEME_IDS` (`@pokatim/contracts`) —
 * равенство сторожит тест в `apps/app`; палитра о транспорте не знает, поэтому список объявлен здесь же.
 */
export type AppThemeId =
  'classic' | 'atlas' | 'chrono' | 'planner' | 'journal' | 'navigation' | 'typography';
/** `'system'` — пара светлая/тёмная по системе; `'dark'` — всегда тёмная. */
export type AppColorScheme = 'system' | 'dark';
/** Отступы карточек и строк списка. */
export type AppDensity = 'regular' | 'comfortable';
/**
 * Плотность → отступы (px из `space`): внутренний отступ карточки списка и зазор между карточками-плитками (вариант
 * `tile`; строки «Классики» разделены hairline и зазора не берут).
 */
export const appDensity: Readonly<Record<AppDensity, { cardPadding: number; listGap: number }>> = {
  regular: { cardPadding: space.s4, listGap: space.s2 },
  comfortable: { cardPadding: space.s5, listGap: space.s3 },
};
/** Вес иконок `expo-symbols`. */
export type IconWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

/** Гарнитуры темы: семейства ролей (файлы — `apps/app/src/theme/fonts.ts`) и CSS-стек веба. */
export interface AppThemeFonts {
  display: string;
  text: string;
  stack: FontStack;
}

/**
 * Варианты раскладки (ADR-0016, слайс C2). Компоненты выбирают вариант таблицей `Record<вариант, компонент>`, без
 * сравнений значения и id темы. У «Классики» — нынешняя раскладка.
 */
export interface AppThemeLayout {
  /** герой раздела «Маршруты» Главной: текстовый, с контуром маршрута, с крупной цифрой */
  home: 'classic' | 'contour' | 'numeral';
  /** шапка шторки карточки маршрута: строка, плитки, крупная дистанция */
  routeStats: 'classic' | 'tiles' | 'numeral';
  /** заливка профиля высоты: градиент, сплошная, без заливки */
  profileFill: 'gradient' | 'solid' | 'line';
  /** таб-бар: полоса и подпись / иконка над подписью */
  tabBar: 'classic' | 'icons';
  /** карточка маршрута в списке: строка с hairline, карточка-плитка, крупная дистанция */
  routeCard: 'classic' | 'tile' | 'numeral';
}

export interface AppThemeDefinition {
  id: AppThemeId;
  /** `'dark'` — всегда тёмная: у таких `schemes.light === schemes.dark` */
  colorScheme: AppColorScheme;
  /** схемы с ролями, группами pokatim и формой (`shape` — внутри схемы: так её читает `shapeOf(useTheme())`) */
  schemes: { light: AppTheme; dark: AppTheme };
  fonts: AppThemeFonts;
  density: AppDensity;
  icons: { weight: IconWeight; filled: boolean };
  layout: AppThemeLayout;
}

/** Сборка определения с проверкой инварианта «всегда тёмная ⇒ одна схема» (ошибка — при загрузке модуля). */
function defineAppTheme(def: AppThemeDefinition): AppThemeDefinition {
  if (def.colorScheme === 'dark' && def.schemes.light !== def.schemes.dark) {
    throw new Error(
      `app theme ${def.id}: colorScheme 'dark' requires schemes.light === schemes.dark`,
    );
  }
  return def;
}

/** «Классика» — нынешние Jersey Aura / Night Ride без визуальных изменений. */
const classic = defineAppTheme({
  id: 'classic',
  colorScheme: 'system',
  schemes: { light: themes.light, dark: themes.dark },
  fonts: { display: font.display, text: font.text, stack: fontStack },
  density: 'regular',
  icons: { weight: 'regular', filled: false },
  layout: {
    home: 'classic',
    routeStats: 'classic',
    profileFill: 'gradient',
    tabBar: 'classic',
    routeCard: 'classic',
  },
});

/** CSS-стеки: гарнитура темы + фолбэк; сжатые — со сжатыми фолбэками. */
const sansStack = (name: string) => `'${name}', system-ui, Arial, sans-serif`;
const interText = fontStack.text;

/** Реестр тем приложения; порядок ключей = `APP_THEME_IDS`. */
export const appThemes: Readonly<Record<AppThemeId, AppThemeDefinition>> = {
  classic,
  atlas: defineAppTheme({
    id: 'atlas',
    colorScheme: 'system',
    schemes: palettes.atlas,
    fonts: {
      display: 'Manrope',
      text: 'Manrope',
      stack: { display: sansStack('Manrope'), text: sansStack('Manrope') },
    },
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
    layout: {
      home: 'contour',
      routeStats: 'classic',
      profileFill: 'gradient',
      tabBar: 'icons',
      routeCard: 'tile',
    },
  }),
  chrono: defineAppTheme({
    id: 'chrono',
    colorScheme: 'dark',
    schemes: { light: palettes.chrono, dark: palettes.chrono },
    fonts: {
      display: 'Roboto Condensed',
      text: font.text,
      stack: {
        display: "'Roboto Condensed', 'Arial Narrow', Arial, sans-serif",
        text: interText,
      },
    },
    density: 'regular',
    icons: { weight: 'semibold', filled: true },
    layout: {
      home: 'classic',
      routeStats: 'tiles',
      profileFill: 'gradient',
      tabBar: 'icons',
      routeCard: 'tile',
    },
  }),
  planner: defineAppTheme({
    id: 'planner',
    colorScheme: 'system',
    schemes: palettes.planner,
    fonts: {
      display: 'Onest',
      text: 'Onest',
      stack: { display: sansStack('Onest'), text: sansStack('Onest') },
    },
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
    layout: {
      home: 'contour',
      routeStats: 'classic',
      profileFill: 'solid',
      tabBar: 'icons',
      routeCard: 'classic',
    },
  }),
  journal: defineAppTheme({
    id: 'journal',
    colorScheme: 'system',
    schemes: palettes.journal,
    fonts: {
      display: 'Golos Text',
      text: 'Golos Text',
      stack: { display: sansStack('Golos Text'), text: sansStack('Golos Text') },
    },
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
    layout: {
      home: 'classic',
      routeStats: 'classic',
      profileFill: 'solid',
      tabBar: 'icons',
      routeCard: 'tile',
    },
  }),
  navigation: defineAppTheme({
    id: 'navigation',
    colorScheme: 'dark',
    schemes: { light: palettes.navigation, dark: palettes.navigation },
    fonts: {
      display: 'Inter Tight',
      text: font.text,
      stack: { display: sansStack('Inter Tight'), text: interText },
    },
    density: 'regular',
    icons: { weight: 'semibold', filled: true },
    layout: {
      home: 'contour',
      routeStats: 'tiles',
      profileFill: 'line',
      tabBar: 'icons',
      routeCard: 'tile',
    },
  }),
  typography: defineAppTheme({
    id: 'typography',
    colorScheme: 'system',
    schemes: palettes.typography,
    fonts: {
      display: 'Oswald',
      text: font.text,
      stack: { display: "Oswald, 'Arial Narrow', Impact, sans-serif", text: interText },
    },
    density: 'regular',
    icons: { weight: 'semibold', filled: false },
    layout: {
      home: 'numeral',
      routeStats: 'numeral',
      profileFill: 'solid',
      tabBar: 'icons',
      routeCard: 'numeral',
    },
  }),
};

/** Тема по умолчанию: нет настройки, незнакомый id, нет сети. */
export const DEFAULT_THEME: AppThemeDefinition = classic;

/** Схема темы: `'dark'` — всегда тёмная, иначе — системная. */
export function appThemeScheme(
  def: AppThemeDefinition,
  system: 'light' | 'dark',
): 'light' | 'dark' {
  return def.colorScheme === 'dark' ? 'dark' : system;
}
