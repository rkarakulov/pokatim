import { describe, expect, it } from 'vitest';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import { ogBrandTexts, ogCardTexts } from './og-card.texts';

describe('ogCardTexts (og-images, D2)', () => {
  it('гонка: окно по Минску через полночь UTC, дистанция и класс', () => {
    expect(ogCardTexts(OG_FIXTURES.race)).toEqual({
      kicker: 'Гонка',
      title: 'Минское кольцо',
      facts: ['24–26 октября 2026', '42,5 км · Шоссе'],
      brand: 'Покатим',
    });
  });

  it('райд: день недели, дата, время; дистанция, темп-диапазон, старт', () => {
    expect(ogCardTexts(OG_FIXTURES.ride)).toEqual({
      kicker: 'Кофе-райд',
      title: 'Кофе-райд на Минское море',
      facts: [
        'Воскресенье, 4 октября 2026, 10:00',
        '42 км · темп 22–24 км/ч · Старт: у Дворца спорта, пр. Победителей',
      ],
      brand: 'Покатим',
    });
    expect(ogCardTexts(ogFixture('ride', { paceMinKmh: 27, paceMaxKmh: 27 })).facts[1]).toBe(
      '42 км · темп 27 км/ч · Старт: у Дворца спорта, пр. Победителей',
    );
  });

  it('маршрут: км, набор (нет — без него), город, «Кольцо» только у петли', () => {
    expect(ogCardTexts(OG_FIXTURES.route)).toMatchObject({
      kicker: 'Маршрут',
      facts: ['64,3 км · набор 412 м', 'Минск · Кольцо'],
    });
    expect(
      ogCardTexts(ogFixture('route', { elevationGainM: null, isLoop: false, city: 'brest' })).facts,
    ).toEqual(['64,3 км', 'Брест']);
  });

  it('старт: даты (один день — одна дата), город, дистанции', () => {
    expect(ogCardTexts(OG_FIXTURES.calendar)).toMatchObject({
      kicker: 'Старт',
      facts: ['14–15 ноября 2026', 'Минск · 60 и 120 км'],
    });
    expect(ogCardTexts(ogFixture('calendar', { endsOn: null, distancesKm: [] })).facts).toEqual([
      '14 ноября 2026',
      'Минск',
    ]);
  });

  it('бренд: название и слоган приложения', () => {
    expect(ogBrandTexts()).toEqual({
      title: 'Покатим',
      tagline: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      brand: 'Покатим',
    });
  });
});
