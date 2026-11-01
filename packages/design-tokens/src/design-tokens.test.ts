import { describe, expect, it } from 'vitest';

import { appThemes } from './app-themes.ts';
import { contrastPairs, contrastPairsOf, contrastRatio, QR_CONTRAST } from './contrast.ts';
import { designSystemCss } from './css.ts';
import { badgeShape, layout } from './index.ts';
import { themes, type ThemeName } from './brand.ts';

/** CSS-переменные прототипов (`:root,[data-theme=light]` / `[data-theme=dark]`) → семантические роли. */
const prototype: Record<'light' | 'dark', Record<string, [string, string]>> = {
  light: {
    '--bg': ['surface.default', '#FFFFFF'],
    '--surface': ['surface.raised', '#F4F4F2'],
    '--ink': ['text.primary', '#111111'],
    '--ink-2': ['text.secondary', '#5C5C5C'],
    '--primary': ['action.primary', '#111111'],
    '--on-primary': ['action.onPrimary', '#FFFFFF'],
    '--accent': ['text.accent', '#C2410C'],
    '--border': ['border.subtle', '#E2E2DF'],
    '--border-2': ['border.strong', '#CFCFCB'],
    '--success': ['status.success', '#1E7A46'],
    '--warning': ['status.warning', '#866C00'],
    '--error': ['status.error', '#B0103A'],
    '--input-border': ['border.input', '#8A8A87'],
    '--input-placeholder': ['text.placeholder', '#5C5C5C'],
    '--focus-ring': ['border.focus', '#111111'],
    '--disabled-bg': ['surface.disabled', '#E2E2DF'],
    '--disabled-fg': ['text.disabled', '#8A8A87'],
    '--map': ['map.background', '#F4F4F2'],
    '--route-core': ['map.route', '#111111'],
    '--corridor-band': ['map.corridor', '#5C5C5C'],
    '--surface-gravel': ['surfaceBar.gravel', '#E2E2DF'],
    '--sheet-bg': ['surface.sheet', '#FFFFFF'],
  },
  dark: {
    '--bg': ['surface.default', '#0E0E0E'],
    '--surface': ['surface.raised', '#1A1A1A'],
    '--ink': ['text.primary', '#F2F2F0'],
    '--ink-2': ['text.secondary', '#A3A3A3'],
    '--on-primary': ['action.onPrimary', '#0E0E0E'],
    '--accent': ['text.accent', '#FF7A45'],
    '--border': ['border.subtle', '#3A3A3A'],
    '--success': ['status.success', '#4CC28A'],
    '--warning': ['status.warning', '#F0CC3C'],
    '--error': ['status.error', '#FF5C8A'],
    '--input-border': ['border.input', '#6E6E6E'],
    '--disabled-fg': ['text.disabled', '#757575'],
    '--corridor-band': ['map.corridor', '#A3A3A3'],
    '--sheet-bg': ['surface.sheet', '#1A1A1A'],
    '--sheet-rule': ['border.sheet', '#474747'],
    '--primary': ['action.primary', '#F2F2F0'],
    '--border-2': ['border.strong', '#474747'],
    '--focus-ring': ['border.focus', '#F2F2F0'],
    '--disabled-bg': ['surface.disabled', '#2E2E2E'],
    '--map': ['map.background', '#1A1A1A'],
    '--route-core': ['map.route', '#F2F2F0'],
    '--surface-gravel': ['surfaceBar.gravel', '#2E2E2E'],
  },
};

const get = (themeName: ThemeName, path: string) =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], themes[themeName]);

describe('семантика совпадает с CSS прототипов', () => {
  for (const themeName of ['light', 'dark'] as const) {
    for (const [cssVar, [role, value]] of Object.entries(prototype[themeName])) {
      it(`${themeName}: ${cssVar} → ${role}`, () => expect(get(themeName, role)).toBe(value));
    }
  }

  it('panel = светлая семантика + тёмная навигация', () => {
    const { nav, ...roles } = themes.panel;
    expect(roles).toEqual(themes.light);
    expect(nav).toMatchObject({
      background: '#111111',
      text: '#CFCFCB',
      activeBackground: '#1A1A1A',
    });
  });
});

describe('контраст WCAG — темы pokatim', () => {
  for (const themeName of Object.keys(themes) as ThemeName[]) {
    it.each(contrastPairs(themeName))(
      `${themeName}: $name ≥ $min`,
      ({ foreground, background, min }) => {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(min);
      },
    );
  }

  it('к парам базы добавлены пары карты pokatim', () => {
    const names = contrastPairs('light').map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'text.primary / surface.default',
        'map.route / map.background',
        'map.corridor / map.background',
        'map.track / map.background',
        'map.offCorridor / map.background',
      ]),
    );
  });

  for (const def of Object.values(appThemes)) {
    for (const scheme of ['light', 'dark'] as const) {
      it.each(contrastPairsOf(def.schemes[scheme]))(
        `тема ${def.id}, ${scheme}: $name ≥ $min`,
        ({ foreground, background, min }) => {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(min);
        },
      );
    }
  }

  it('пары слайса C: профиль в шторке, акцент на карточке, подписи вкладок', () => {
    expect(contrastPairs('light').map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'profile.line / surface.sheet',
        'text.accent / surface.raised',
        'tabBar.active / tabBar.background',
        'tabBar.inactive / tabBar.background',
        'map.start / map.route',
      ]),
    );
  });

  it('QR билета: пара ink/paper ≥ 7:1 во всех темах приложения, «бумага» светлее модулей (RC-B5)', () => {
    for (const def of Object.values(appThemes)) {
      for (const scheme of ['light', 'dark'] as const) {
        const pair = contrastPairsOf(def.schemes[scheme]).find(
          (p) => p.name === 'ticket.qrInk / ticket.qrPaper',
        );
        expect(pair?.min).toBe(QR_CONTRAST);
        const { qrInk, qrPaper } = def.schemes[scheme].ticket;
        expect(contrastRatio(qrInk, qrPaper)).toBeGreaterThanOrEqual(QR_CONTRAST);
        expect(contrastRatio(qrPaper, '#000000')).toBeGreaterThan(contrastRatio(qrInk, '#000000'));
      }
    }
  });

  it('к парам добавлена линия профиля высоты', () => {
    expect(contrastPairs('light').map((p) => p.name)).toContain('profile.line / surface.default');
  });

  it('пары навигации — только у panel', () => {
    expect(contrastPairs('light').some((p) => p.name.startsWith('nav.'))).toBe(false);
    expect(contrastPairs('panel').some((p) => p.name.startsWith('nav.'))).toBe(true);
  });
});

describe('CSS для веба (обёртка с брендом pokatim)', () => {
  const rootBlock = (css: string) => css.slice(0, css.indexOf('\n}'));

  it('переменные темы: семантика и группы pokatim, навигация только у panel', () => {
    const light = designSystemCss({ theme: 'light' });
    expect(light).toContain('--color-text-primary: #111111;');
    expect(light).toContain('--color-map-route: #111111;');
    expect(light).toContain('--color-surface-bar-gravel: #E2E2DF;');
    expect(light).toContain(
      "--font-display: 'Playfair Display', 'PT Serif', Georgia, 'Times New Roman', serif;",
    );
    expect(light).not.toContain('--nav-');
    expect(designSystemCss({ theme: 'dark' })).toContain('color-scheme: dark;');
    expect(designSystemCss({ theme: 'panel' })).toContain('--nav-background: #111111;');
  });

  it('подложка карты — не цвет: в CSS нет; профиль высоты — переменные --color-profile-*', () => {
    const panel = designSystemCss({ theme: 'panel' });
    expect(panel).not.toContain('--color-map-basemap');
    expect(panel).toContain('--color-profile-line: #5C5C5C;');
  });

  it('вкладки — переменные --color-tab-bar-* (роли «Классики»)', () => {
    const light = designSystemCss({ theme: 'light' });
    expect(light).toContain('--color-tab-bar-background: #FFFFFF;');
    expect(light).toContain('--color-tab-bar-active: #111111;');
    expect(light).toContain('--color-tab-bar-inactive: #5C5C5C;');
  });

  it('плотность — только у темы panel', () => {
    expect(rootBlock(designSystemCss({ theme: 'panel' }))).toContain(
      '--density-control-height: 36px;',
    );
    expect(designSystemCss({ theme: 'light', darkTheme: 'dark' })).not.toContain('--density-');
  });

  it('тёмная тема подключается через prefers-color-scheme', () => {
    const css = designSystemCss({ theme: 'light', darkTheme: 'dark' });
    expect(rootBlock(css)).toContain('color-scheme: light;');
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--color-surface-default: #0E0E0E;[^}]*color-scheme: dark;/,
    );
  });
});

describe('раскладка приложения (layout)', () => {
  it('аватар шапки профиля — 56 px (`.phead-name .ava` прототипа, rider-profile)', () => {
    expect(layout).toMatchObject({ contentMaxWidth: 640, avatarProfile: 56 });
  });

  it('значок «Эмаль» (achievements): 72 в сетке, 152 на вспышке; кольцо и диск вписаны в диаметр', () => {
    expect(layout).toEqual({
      contentMaxWidth: 640,
      avatarProfile: 56,
      badgeGrid: 72,
      badgeHero: 152,
      ticketQr: 240,
      mutedOpacity: 0.45,
    });
    // диск не перекрывает кольцо: отступ + толщина кольца с двух сторон + диск ≤ 1
    expect(2 * (badgeShape.ringInset + badgeShape.ringWidth) + badgeShape.disc).toBeLessThanOrEqual(
      1,
    );
    expect(badgeShape.icon).toBeLessThan(badgeShape.disc);
  });
});
