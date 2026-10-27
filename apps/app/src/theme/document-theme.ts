import { autofillCss, type AppThemeDefinition } from '@pokatim/design-tokens';

const DARK = '(prefers-color-scheme: dark)';
const LIGHT = '(prefers-color-scheme: light)';

const background = (color: string) => `html, body { background-color: ${color}; }`;

/**
 * Стили документа до гидрации (`+html.tsx`, только сервер): фон из темы — без белой вспышки в тёмной схеме — и
 * автозаполнение браузера (фон и текст поля темы вместо заливки браузера). Тема по системе — светлая + `@media`,
 * «всегда тёмная» — одна тёмная.
 */
export function documentCss(def: AppThemeDefinition): string {
  const { light, dark } = def.schemes;
  if (def.colorScheme === 'dark') {
    return [background(dark.surface.default), autofillCss({ theme: dark })].join('\n');
  }
  return [
    background(light.surface.default),
    `@media ${DARK} {\n  ${background(dark.surface.default)}\n}`,
    autofillCss({ theme: light, darkTheme: dark }),
  ].join('\n');
}

/** `<meta name="theme-color">` (цвет панели браузера): по схеме системы или один у «всегда тёмной». */
export function themeColors(def: AppThemeDefinition): { media?: string; color: string }[] {
  const { light, dark } = def.schemes;
  if (def.colorScheme === 'dark') return [{ color: dark.surface.default }];
  return [
    { media: LIGHT, color: light.surface.default },
    { media: DARK, color: dark.surface.default },
  ];
}

/** Цвет PWA (`theme_color`, `background_color` manifest): схемы системы манифест не знает — светлая или тёмная темы. */
export function manifestColor(def: AppThemeDefinition): string {
  return def.schemes[def.colorScheme === 'dark' ? 'dark' : 'light'].surface.default;
}
