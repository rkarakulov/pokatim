import { describe, expect, it } from 'vitest';

import {
  APP_THEME_IDS,
  AppAppearance,
  AppThemeId,
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

describe('UpdateAppearanceRequest', () => {
  it('каждая тема из списка с версией — валидна', () => {
    for (const themeId of APP_THEME_IDS) {
      expect(UpdateAppearanceRequest.parse({ themeId, version: 3 })).toEqual({
        themeId,
        version: 3,
      });
    }
  });

  it('неизвестная тема — INVALID на поле themeId', () => {
    const result = UpdateAppearanceRequest.safeParse({ themeId: 'neon', version: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['themeId'], message: 'INVALID' }),
    ]);
  });

  it('лишний ключ, отрицательная, дробная, строковая и объектная версия — ошибка', () => {
    expect(
      UpdateAppearanceRequest.safeParse({ themeId: 'atlas', version: 0, updatedAt: 'x' }).success,
    ).toBe(false);
    for (const version of [-1, 1.5, '1', { $ne: null }]) {
      expect(UpdateAppearanceRequest.safeParse({ themeId: 'atlas', version }).success).toBe(false);
    }
    expect(UpdateAppearanceRequest.safeParse({ themeId: { $ne: null }, version: 0 }).success).toBe(
      false,
    );
  });
});

describe('AppAppearance (ответ приложения)', () => {
  it('известная тема — как есть, незнакомая — unknown', () => {
    expect(AppAppearance.parse({ themeId: 'chrono' })).toEqual({ themeId: 'chrono' });
    expect(AppAppearance.parse({ themeId: 'future-theme' })).toEqual({ themeId: 'unknown' });
  });
});

describe('PanelAppearance (ответ панели)', () => {
  it('updatedAt — null, пока настройку не меняли; тема — строгий enum', () => {
    const fresh = { themeId: 'classic', version: 0, updatedAt: null };
    expect(PanelAppearance.parse(fresh)).toEqual(fresh);
    const changed = { themeId: 'atlas', version: 1, updatedAt: '2026-10-27T10:00:00.000Z' };
    expect(PanelAppearance.parse(changed)).toEqual(changed);
    expect(PanelAppearance.safeParse({ ...fresh, themeId: 'future-theme' }).success).toBe(false);
  });
});
