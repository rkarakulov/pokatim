import type { FontStack } from '@rkarakulov/design-tokens';

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
/** Вес иконок `expo-symbols`. */
export type IconWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

/** Гарнитуры темы: семейства ролей (файлы — `apps/app/src/theme/fonts.ts`) и CSS-стек веба. */
export interface AppThemeFonts {
  display: string;
  text: string;
  stack: FontStack;
}

/** Варианты раскладки (слайс C расширяет объединения; у «Классики» — нынешние). */
export interface AppThemeLayout {
  home: 'classic';
  routeStats: 'classic';
  profileFill: 'gradient';
  tabBar: 'classic';
  routeCard: 'classic';
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

/** Реестр тем приложения; порядок ключей = `APP_THEME_IDS`. */
export const appThemes: Readonly<Record<AppThemeId, AppThemeDefinition>> = {
  classic,
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  atlas: defineAppTheme({ ...classic, id: 'atlas' }),
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  chrono: defineAppTheme({ ...classic, id: 'chrono' }),
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  planner: defineAppTheme({ ...classic, id: 'planner' }),
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  journal: defineAppTheme({ ...classic, id: 'journal' }),
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  navigation: defineAppTheme({ ...classic, id: 'navigation' }),
  // TODO(app-themes C): палитра, шрифты, форма, раскладка
  typography: defineAppTheme({ ...classic, id: 'typography' }),
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
