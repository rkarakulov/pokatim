import { describe, expect, it } from 'vitest';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import { ogBrandTexts, ogCardAlt, ogCardTexts } from './og-card.texts';

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

  it('сезон: метка, название, даты с годом и «N гонок»; 0 гонок — без строки', () => {
    expect(ogCardTexts(OG_FIXTURES.season)).toEqual({
      kicker: 'Сезон',
      title: 'Кубок Минска 2026',
      facts: ['1 апреля–31 октября 2026', '12 гонок'],
      brand: 'Покатим',
    });
    expect(ogCardTexts(ogFixture('season', { raceCount: 1 })).facts[1]).toBe('1 гонка');
    expect(ogCardTexts(ogFixture('season', { raceCount: 3 })).facts[1]).toBe('3 гонки');
    expect(ogCardTexts(ogFixture('season', { raceCount: 0 })).facts).toEqual([
      '1 апреля–31 октября 2026',
    ]);
  });

  it('райдер: «Профиль райдера» без имени; гонки · подиумы, лучшее место', () => {
    expect(ogCardTexts(OG_FIXTURES.rider)).toEqual({
      kicker: 'Райдер',
      title: 'Профиль райдера',
      facts: ['7 гонок · 2 подиума', 'Лучшее место: 1'],
      brand: 'Покатим',
    });
    expect(ogCardTexts(ogFixture('rider', { races: 1, podiums: 0, bestPlace: 4 })).facts).toEqual([
      '1 гонка',
      'Лучшее место: 4',
    ]);
    // только финиши без места: лучшего места нет
    expect(
      ogCardTexts(ogFixture('rider', { races: 3, podiums: 0, bestPlace: null })).facts,
    ).toEqual(['3 гонки']);
    expect(
      ogCardTexts(ogFixture('rider', { races: 0, podiums: 0, bestPlace: null })).facts,
    ).toEqual(['Пока без гонок']);
  });

  it('alt: сезон — с названием, райдер — без имени', () => {
    expect(ogCardAlt(OG_FIXTURES.season)).toBe('Сезон «Кубок Минска 2026»');
    expect(ogCardAlt(OG_FIXTURES.rider)).toBe('Профиль райдера — Покатим');
  });

  it('бренд: название и слоган приложения (без колонтитула)', () => {
    expect(ogBrandTexts()).toEqual({
      title: 'Покатим',
      tagline: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    });
  });
});
