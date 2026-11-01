import { describe, expect, it } from 'vitest';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import { ogCardHash, ogCardVersion, type OgCardInput } from './og-card.inputs';
import { OG_CARD_POLICY } from './sharing.policy';

describe('ogCardHash (og-images, D4)', () => {
  it('детерминирован; версия — первые 16 hex', () => {
    const hash = ogCardHash(OG_FIXTURES.race);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ogCardHash(ogFixture('race'))).toBe(hash);
    expect(ogCardVersion(hash)).toBe(hash.slice(0, 16));
  });

  it('меняется от темы и каждого поля карточки вида', () => {
    const base: Exclude<OgCardInput, { kind: 'brand' }>[] = [
      OG_FIXTURES.race,
      OG_FIXTURES.ride,
      OG_FIXTURES.route,
      OG_FIXTURES.calendar,
      OG_FIXTURES.season,
      OG_FIXTURES.rider,
    ];
    for (const input of base) {
      const hash = ogCardHash(input);
      expect(ogCardHash({ ...input, themeId: 'chrono' } as OgCardInput)).not.toBe(hash);
      for (const [field, value] of Object.entries(input.facts)) {
        const changed =
          value instanceof Date
            ? new Date(value.getTime() + 60_000)
            : typeof value === 'number'
              ? value + 1
              : typeof value === 'boolean'
                ? !value
                : Array.isArray(value)
                  ? [...(value as number[]), 1]
                  : value === null
                    ? 'x'
                    : `${String(value)}x`;
        const next = { ...input, facts: { ...input.facts, [field]: changed } } as OgCardInput;
        expect(ogCardHash(next), `${input.kind}.${field}`).not.toBe(hash);
      }
    }
  });

  it('схема входит в хэш: та же фактура light ↔ dark — разные хэши', () => {
    for (const input of [OG_FIXTURES.race, OG_FIXTURES.ride, OG_FIXTURES.brand] as OgCardInput[]) {
      const other = input.scheme === 'dark' ? 'light' : 'dark';
      expect(ogCardHash({ ...input, scheme: other }), input.kind).not.toBe(ogCardHash(input));
    }
  });

  it('райдер: статистика меняет хэш; лучшего места нет — свой хэш; в фактах нет имени, клуба, фото', () => {
    const hash = ogCardHash(OG_FIXTURES.rider);
    expect(ogCardHash(ogFixture('rider', { races: 8 }))).not.toBe(hash);
    expect(ogCardHash(ogFixture('rider', { podiums: 3 }))).not.toBe(hash);
    expect(ogCardHash(ogFixture('rider', { bestPlace: null }))).not.toBe(hash);
    // структурно: в фактах только publicId и числа
    expect(Object.keys(OG_FIXTURES.rider.facts).sort()).toEqual([
      'bestPlace',
      'podiums',
      'publicId',
      'races',
    ]);
    const extra = {
      ...OG_FIXTURES.rider,
      facts: { ...OG_FIXTURES.rider.facts, name: 'Анна', club: 'Velo', avatarId: 'x' },
    } as OgCardInput;
    expect(ogCardHash(extra)).toBe(hash);
  });

  it('routeId → null (маршрут ушёл из каталога) меняет хэш райда и гонки', () => {
    const ride = ogFixture('ride', { routeId: '01890a5d-ac96-774b-bcce-b302099a8009' });
    expect(ogCardHash(ogFixture('ride', { routeId: null }))).not.toBe(ogCardHash(ride));
    expect(ogCardHash(ogFixture('race', { routeId: null }))).not.toBe(ogCardHash(OG_FIXTURES.race));
  });

  it('не зависит от полей вне карточки', () => {
    const extra = {
      ...OG_FIXTURES.ride,
      facts: { ...OG_FIXTURES.ride.facts, organizerName: 'Иван' },
    } as OgCardInput;
    expect(ogCardHash(extra)).toBe(ogCardHash(OG_FIXTURES.ride));
  });

  it('фото райда меняет ключ OG (ride-photo-followups): загрузка, замена и снятие — новая версия', () => {
    const plain = ogCardHash(ogFixture('ride', { photoId: null }));
    const first = ogCardHash(ogFixture('ride', { photoId: 'photo-a' }));
    const second = ogCardHash(ogFixture('ride', { photoId: 'photo-b' }));
    expect(new Set([plain, first, second]).size).toBe(3);
  });

  it('разные виды с одинаковыми полями — разные хэши; бренд — свой', () => {
    const asCalendar = { ...OG_FIXTURES.race, kind: 'calendar' } as unknown as OgCardInput;
    expect(ogCardHash(asCalendar)).not.toBe(ogCardHash(OG_FIXTURES.race));
    expect(ogCardHash(OG_FIXTURES.brand)).not.toBe(ogCardHash(OG_FIXTURES.race));
  });

  it('входит версия рендера: другая версия — другой хэш', () => {
    const policy = OG_CARD_POLICY as { renderVersion: number };
    const hash = ogCardHash(OG_FIXTURES.race);
    const previous = policy.renderVersion;
    policy.renderVersion = previous + 1;
    try {
      expect(ogCardHash(OG_FIXTURES.race)).not.toBe(hash);
    } finally {
      policy.renderVersion = previous;
    }
  });
});
