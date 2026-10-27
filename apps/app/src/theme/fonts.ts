import {
  appThemes,
  type AppThemeDefinition,
  type AppThemeId,
  type FontRole,
  type FontWeight,
} from '@pokatim/design-tokens';
import { GolosText_400Regular } from '@expo-google-fonts/golos-text/400Regular';
import { GolosText_500Medium } from '@expo-google-fonts/golos-text/500Medium';
import { GolosText_600SemiBold } from '@expo-google-fonts/golos-text/600SemiBold';
import { GolosText_700Bold } from '@expo-google-fonts/golos-text/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { InterTight_500Medium } from '@expo-google-fonts/inter-tight/500Medium';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Onest_700Bold } from '@expo-google-fonts/onest/700Bold';
import { Oswald_500Medium } from '@expo-google-fonts/oswald/500Medium';
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald/600SemiBold';
import { PlayfairDisplay_500Medium } from '@expo-google-fonts/playfair-display/500Medium';
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display/600SemiBold';
import { RobotoCondensed_500Medium } from '@expo-google-fonts/roboto-condensed/500Medium';
import { RobotoCondensed_700Bold } from '@expo-google-fonts/roboto-condensed/700Bold';
import type { FontSource } from 'expo-font';

/**
 * Все файлы гарнитур всех тем (native бандлит всё; грузится — только набор активной темы, `useThemeFonts`).
 * Подключаем только нужные начертания: импорт из корня пакета тянет в бандл все файлы семейства.
 */
export const fontAssets = {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
  GolosText_700Bold,
  InterTight_500Medium,
  InterTight_600SemiBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Onest_400Regular,
  Onest_500Medium,
  Onest_600SemiBold,
  Onest_700Bold,
  Oswald_500Medium,
  Oswald_600SemiBold,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
  RobotoCondensed_500Medium,
  RobotoCondensed_700Bold,
};

type FontFamily = keyof typeof fontAssets;
type RoleFamilies<R extends FontRole> = Record<FontWeight<R>, FontFamily>;

/** Шрифты темы: семейства ролей (`FontFamilies` базы) и файлы, которые нужно загрузить. */
export interface ThemeFontSet {
  families: { [R in FontRole]: RoleFamilies<R> };
  assets: Partial<Record<FontFamily, FontSource>>;
}

/**
 * Гарнитура (`AppThemeFonts.display|text` темы) → семейства по весам роли. Android не синтезирует вес: у каждого
 * веса своё семейство. Новая гарнитура темы — файлы в `fontAssets` и строка здесь.
 */
const FACES: Record<string, { display?: RoleFamilies<'display'>; text?: RoleFamilies<'text'> }> = {
  'Playfair Display': {
    display: { 500: 'PlayfairDisplay_500Medium', 600: 'PlayfairDisplay_600SemiBold' },
  },
  Inter: {
    text: {
      400: 'Inter_400Regular',
      500: 'Inter_500Medium',
      600: 'Inter_600SemiBold',
      700: 'Inter_700Bold',
    },
  },
  // одна гарнитура на обе роли (одна запись): display 600 — файл 700, заголовок плотнее текста 600
  Manrope: {
    display: { 500: 'Manrope_500Medium', 600: 'Manrope_700Bold' },
    text: {
      400: 'Manrope_400Regular',
      500: 'Manrope_500Medium',
      600: 'Manrope_600SemiBold',
      700: 'Manrope_700Bold',
    },
  },
  Onest: {
    display: { 500: 'Onest_500Medium', 600: 'Onest_600SemiBold' },
    text: {
      400: 'Onest_400Regular',
      500: 'Onest_500Medium',
      600: 'Onest_600SemiBold',
      700: 'Onest_700Bold',
    },
  },
  'Golos Text': {
    display: { 500: 'GolosText_500Medium', 600: 'GolosText_600SemiBold' },
    text: {
      400: 'GolosText_400Regular',
      500: 'GolosText_500Medium',
      600: 'GolosText_600SemiBold',
      700: 'GolosText_700Bold',
    },
  },
  // сжатые цифры плотнее: display 600 — файл 700
  'Roboto Condensed': {
    display: { 500: 'RobotoCondensed_500Medium', 600: 'RobotoCondensed_700Bold' },
  },
  'Inter Tight': {
    display: { 500: 'InterTight_500Medium', 600: 'InterTight_600SemiBold' },
  },
  Oswald: {
    display: { 500: 'Oswald_500Medium', 600: 'Oswald_600SemiBold' },
  },
};

function face<R extends FontRole>(role: R, name: string): RoleFamilies<R> {
  const families = FACES[name]?.[role] as RoleFamilies<R> | undefined;
  if (!families) throw new Error(`theme fonts: no ${role} faces for "${name}" in fonts.ts`);
  return families;
}

function buildFontSet(def: AppThemeDefinition): ThemeFontSet {
  const families = {
    display: face('display', def.fonts.display),
    text: face('text', def.fonts.text),
  };
  const names = [...Object.values(families.display), ...Object.values(families.text)];
  return { families, assets: Object.fromEntries(names.map((name) => [name, fontAssets[name]])) };
}

// все темы реестра — при загрузке модуля: неизвестная гарнитура ломает запуск сразу, а не при смене темы
const sets = new Map<AppThemeId, ThemeFontSet>(
  Object.values(appThemes).map((def) => [def.id, buildFontSet(def)]),
);

/** Шрифты темы; один и тот же объект для темы (зависимость эффекта загрузки). */
export function themeFonts(def: AppThemeDefinition): ThemeFontSet {
  let set = sets.get(def.id);
  if (!set) {
    set = buildFontSet(def);
    sets.set(def.id, set);
  }
  return set;
}

/** Семейства «Классики» для `configureDesignSystem` (фолбэк без `ThemeProvider`: тесты компонентов). */
export const fontFamilies = themeFonts(appThemes.classic).families;
