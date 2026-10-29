import { describe, expect, it } from 'vitest';

import {
  APP_DECOR_IDS,
  APP_THEME_IDS,
  AppDecorId,
  AppAppearance,
  AppThemeId,
  DEFAULT_APP_DECOR_ID,
  DEFAULT_APP_THEME_ID,
  PanelAppearance,
  UpdateAppearanceRequest,
} from './appearance.schema.ts';

describe('AppThemeId', () => {
  it('темы — в установленном порядке; новые только в конец (R6); по умолчанию — «Классика»', () => {
    expect(APP_THEME_IDS).toEqual([
      'classic',
      'atlas',
      'chrono',
      'planner',
      'journal',
      'navigation',
      'typography',
    ]);
    expect(DEFAULT_APP_THEME_ID).toBe('classic');
    expect(AppThemeId.safeParse('neon').success).toBe(false);
  });
});

describe('UpdateAppearanceRequest (user-theme: только декор)', () => {
  it('декор с версией — валиден', () => {
    for (const decor of APP_DECOR_IDS) {
      expect(UpdateAppearanceRequest.parse({ decor, version: 3 })).toEqual({ decor, version: 3 });
    }
  });

  it('themeId — лишний ключ (тема — личная, A11); без декора — ошибка', () => {
    expect(UpdateAppearanceRequest.safeParse({ themeId: 'atlas', version: 0 }).success).toBe(false);
    expect(
      UpdateAppearanceRequest.safeParse({ themeId: 'atlas', decor: 'none', version: 0 }).success,
    ).toBe(false);
    expect(UpdateAppearanceRequest.safeParse({ version: 0 }).success).toBe(false);
  });

  it('лишний ключ, отрицательная, дробная, строковая и объектная версия — ошибка', () => {
    expect(
      UpdateAppearanceRequest.safeParse({ decor: 'none', version: 0, updatedAt: 'x' }).success,
    ).toBe(false);
    for (const version of [-1, 1.5, '1', { $ne: null }]) {
      expect(UpdateAppearanceRequest.safeParse({ decor: 'none', version }).success).toBe(false);
    }
    expect(UpdateAppearanceRequest.safeParse({ decor: { $ne: null }, version: 0 }).success).toBe(
      false,
    );
  });
});

describe('AppAppearance (ответ приложения)', () => {
  it('известная тема — как есть, незнакомая — unknown', () => {
    expect(AppAppearance.parse({ themeId: 'chrono' })).toEqual({ themeId: 'chrono' });
    expect(AppAppearance.parse({ themeId: 'future-theme' })).toEqual({ themeId: 'unknown' });
  });

  it('декор: известный — как есть, незнакомый — unknown, нет ключа (старый API) — без поля', () => {
    expect(AppAppearance.parse({ themeId: 'classic', decor: 'halloween' })).toEqual({
      themeId: 'classic',
      decor: 'halloween',
    });
    expect(AppAppearance.parse({ themeId: 'classic', decor: 'new-year' })).toEqual({
      themeId: 'classic',
      decor: 'unknown',
    });
    expect(AppAppearance.parse({ themeId: 'classic' })).toEqual({ themeId: 'classic' });
  });
});

describe('AppDecorId (halloween-decor)', () => {
  it('декоры — в установленном порядке, только в конец; по умолчанию — без декора', () => {
    expect(APP_DECOR_IDS).toEqual(['none', 'halloween']);
    expect(DEFAULT_APP_DECOR_ID).toBe('none');
    expect(AppDecorId.safeParse('new-year').success).toBe(false);
  });
});

describe('UpdateAppearanceRequest — декор (halloween-decor)', () => {
  it('неизвестный декор — INVALID на поле decor', () => {
    const result = UpdateAppearanceRequest.safeParse({ decor: 'new-year', version: 0 });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['decor'], message: 'INVALID' }),
    ]);
  });
});

describe('PanelAppearance (ответ панели)', () => {
  it('updatedAt — null, пока настройку не меняли; только декор (user-theme)', () => {
    const fresh = { decor: 'none', version: 0, updatedAt: null };
    expect(PanelAppearance.parse(fresh)).toEqual(fresh);
    const changed = { decor: 'halloween', version: 1, updatedAt: '2026-10-27T10:00:00.000Z' };
    expect(PanelAppearance.parse(changed)).toEqual(changed);
    expect(PanelAppearance.parse({ ...fresh, themeId: 'atlas' })).toEqual(fresh);
    expect(PanelAppearance.safeParse({ ...fresh, decor: 'new-year' }).success).toBe(false);
  });
});
