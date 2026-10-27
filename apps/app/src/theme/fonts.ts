import {
  appThemes,
  type AppThemeDefinition,
  type AppThemeId,
  type FontRole,
  type FontWeight,
} from '@pokatim/design-tokens';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { PlayfairDisplay_500Medium } from '@expo-google-fonts/playfair-display/500Medium';
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display/600SemiBold';
import type { FontSource } from 'expo-font';

/**
 * Все файлы гарнитур всех тем (native бандлит всё; грузится — только набор активной темы, `useThemeFonts`).
 * Подключаем только нужные начертания: импорт из корня пакета тянет в бандл все файлы семейства.
 */
export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
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
