/// <reference types="jest" />
import { appThemes, type AppThemeDefinition } from '@pokatim/design-tokens';

import { documentCss, manifestColor, themeColors } from './document-theme';

const classic = appThemes.classic;
const darkOnly: AppThemeDefinition = {
  ...classic,
  colorScheme: 'dark',
  schemes: { light: classic.schemes.dark, dark: classic.schemes.dark },
};

describe('документ web в теме приложения', () => {
  it('«Классика»: фон по системе (#FFFFFF, тёмная — #0E0E0E) и autofill обеих схем', () => {
    const css = documentCss(classic);
    expect(css).toContain('html, body { background-color: #FFFFFF; }');
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*html, body \{ background-color: #0E0E0E; \}/,
    );
    expect(css).toContain('input:-webkit-autofill');
    expect(css.match(/prefers-color-scheme: dark/g)).toHaveLength(2);
  });

  it('«Классика»: две theme-color по схеме, manifest — светлый фон', () => {
    expect(themeColors(classic)).toEqual([
      { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
      { media: '(prefers-color-scheme: dark)', color: '#0E0E0E' },
    ]);
    expect(manifestColor(classic)).toBe('#FFFFFF');
  });

  it('тема «всегда тёмная»: одна тёмная схема без media', () => {
    const css = documentCss(darkOnly);
    expect(css).toContain('html, body { background-color: #0E0E0E; }');
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('#FFFFFF');
    expect(themeColors(darkOnly)).toEqual([{ color: '#0E0E0E' }]);
    expect(manifestColor(darkOnly)).toBe('#0E0E0E');
  });
});
