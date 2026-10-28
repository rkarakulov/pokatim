import {
  appThemes,
  fontFilesOf,
  type AppThemeDefinition,
  type FontFileId,
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
export const fontAssets: Record<FontFileId, FontSource> = {
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

type FontFamily = FontFileId;
type RoleFamilies<R extends FontRole> = Record<FontWeight<R>, FontFamily>;

/** Шрифты темы: семейства ролей (`FontFamilies` базы) и файлы, которые нужно загрузить. */
export interface ThemeFontSet {
  families: { [R in FontRole]: RoleFamilies<R> };
  assets: Partial<Record<FontFamily, FontSource>>;
}

function buildFontSet(def: AppThemeDefinition): ThemeFontSet {
  // гарнитура → файлы по весам роли — `appFontFaces` (`@pokatim/design-tokens`, общая с API: карточка для сторис)
  const families = {
    display: fontFilesOf('display', def.fonts.display),
    text: fontFilesOf('text', def.fonts.text),
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
