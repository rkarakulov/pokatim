import type { FontRole, FontWeight } from '@rkarakulov/design-tokens';

/**
 * Файлы начертаний гарнитур тем (`@expo-google-fonts/*`): id файла `Семейство_ВесИмя` — экспорт пакета в приложении
 * и имя `.ttf` на сервере (карточка для сторис). Только данные, без ассетов: приложение подключает файлы статическими
 * импортами (`apps/app/src/theme/fonts.ts`), API — `require.resolve` пакета шрифта.
 */
export const APP_FONT_FILE_IDS = [
  'GolosText_400Regular',
  'GolosText_500Medium',
  'GolosText_600SemiBold',
  'GolosText_700Bold',
  'InterTight_500Medium',
  'InterTight_600SemiBold',
  'Inter_400Regular',
  'Inter_500Medium',
  'Inter_600SemiBold',
  'Inter_700Bold',
  'Manrope_400Regular',
  'Manrope_500Medium',
  'Manrope_600SemiBold',
  'Manrope_700Bold',
  'Onest_400Regular',
  'Onest_500Medium',
  'Onest_600SemiBold',
  'Onest_700Bold',
  'Oswald_500Medium',
  'Oswald_600SemiBold',
  'PlayfairDisplay_500Medium',
  'PlayfairDisplay_600SemiBold',
  'RobotoCondensed_500Medium',
  'RobotoCondensed_700Bold',
] as const;
export type FontFileId = (typeof APP_FONT_FILE_IDS)[number];

/** Файлы роли по весам: у каждого веса свой файл (Android не синтезирует вес). */
export type RoleFontFiles<R extends FontRole> = Record<FontWeight<R>, FontFileId>;

/**
 * Гарнитура (`AppThemeFonts.display|text` темы) → файлы по весам роли. Новая гарнитура темы — id файлов выше, строка
 * здесь и импорт файла в приложении.
 */
export const appFontFaces: Readonly<
  Record<string, { display?: RoleFontFiles<'display'>; text?: RoleFontFiles<'text'> }>
> = {
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

/** Файлы роли гарнитуры; гарнитуры нет в таблице — ошибка (тема без файлов не загрузится ни в приложении, ни в API). */
export function fontFilesOf<R extends FontRole>(role: R, face: string): RoleFontFiles<R> {
  const files = appFontFaces[face]?.[role] as RoleFontFiles<R> | undefined;
  if (!files) throw new Error(`theme fonts: no ${role} faces for "${face}" in appFontFaces`);
  return files;
}
