import { describe, expect, it } from 'vitest';

import { appThemes } from './app-themes.ts';
import { contrastRatio, WCAG } from './contrast.ts';
import {
  photoScrim,
  photoScrimAlpha,
  photoScrimHero,
  type PhotoScrimProfile,
} from './photo-scrim.ts';

/** Цвет скрима с прозрачностью `alpha` поверх белого фото (худший случай для белого текста). */
function overWhite(scrim: string, alpha: number): string {
  const channel = (offset: number) => {
    const value = parseInt(scrim.slice(offset, offset + 2), 16);
    return Math.round(value * alpha + 255 * (1 - alpha));
  };
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, '0')).join('')}`;
}

/** onPhoto над скримом профиля поверх белого фото в каждой точке зон текста — не ниже 4.5:1 (все темы и схемы). */
function expectTextZonesReadable(profile: PhotoScrimProfile) {
  for (const [id, theme] of Object.entries(appThemes)) {
    for (const scheme of [theme.schemes.light, theme.schemes.dark]) {
      for (const zone of profile.textZones) {
        for (let at = zone.from; at <= zone.to + 1e-9; at += 0.005) {
          const background = overWhite(scheme.overlay.scrim, photoScrimAlpha(at, profile));
          expect(
            contrastRatio(scheme.text.onPhoto, background),
            `${id} ${at.toFixed(3)}`,
          ).toBeGreaterThanOrEqual(WCAG.text);
        }
      }
    }
  }
}

describe('photoScrim — затемнение фото под текстом (ride-photo, R7)', () => {
  it('остановки по возрастанию на [0, 1], прозрачность в [0, 1]; интерполяция линейная', () => {
    const ats = photoScrim.stops.map((stop) => stop.at);
    expect(ats[0]).toBe(0);
    expect(ats.at(-1)).toBe(1);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    for (const stop of photoScrim.stops) {
      expect(stop.alpha).toBeGreaterThanOrEqual(0);
      expect(stop.alpha).toBeLessThanOrEqual(1);
    }
    const [first, second] = photoScrim.stops;
    if (!first || !second) throw new Error('нет остановок');
    expect(photoScrimAlpha((first.at + second.at) / 2)).toBeCloseTo(
      (first.alpha + second.alpha) / 2,
    );
  });

  it('в зонах текста onPhoto над скримом поверх белого фото — не ниже 4.5:1 (все темы и схемы)', () => {
    expectTextZonesReadable(photoScrim);
  });

  it('середина кадра светлее зон текста — фото видно', () => {
    const middle = photoScrimAlpha(0.2);
    expect(middle).toBeLessThan(photoScrimAlpha(0));
    expect(middle).toBeLessThan(photoScrimAlpha(1));
  });
});

describe('photoScrimHero — затемнение героя ленты и Главной (ride-photo PR B)', () => {
  it('без провала: прозрачность монотонно нарастает к низу (верх светлее — фото видно)', () => {
    const ats = photoScrimHero.stops.map((stop) => stop.at);
    expect(ats[0]).toBe(0);
    expect(ats.at(-1)).toBe(1);
    for (let at = 0; at < 1; at += 0.01) {
      expect(photoScrimAlpha(at + 0.01, photoScrimHero)).toBeGreaterThanOrEqual(
        photoScrimAlpha(at, photoScrimHero),
      );
    }
    expect(photoScrimAlpha(0, photoScrimHero)).toBeLessThan(photoScrimAlpha(1, photoScrimHero));
  });

  it('зона текста — вся высота блока (кикер у верха при длинном названии и крупном шрифте)', () => {
    expect(photoScrimHero.textZones).toEqual([{ from: 0, to: 1 }]);
  });

  it('на всей высоте onPhoto поверх белого фото — не ниже 4.5:1 (все темы и схемы)', () => {
    expectTextZonesReadable(photoScrimHero);
  });
});
