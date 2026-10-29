import { describe, expect, it } from 'vitest';

import { OG_CARD_POLICY, ogPrerenderable } from './sharing.policy';

const NOW = new Date('2026-10-29T10:00:00Z');
const DAY = 86_400_000;
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs);

describe('OG_CARD_POLICY (вариант A R-A1)', () => {
  it('PNG 7 суток, ≤ 300 КБ, приоритет задач задан', () => {
    expect(OG_CARD_POLICY.pngTtlSec).toBe(7 * 86_400);
    expect(OG_CARD_POLICY.maxPngBytes).toBe(300_000);
    expect(OG_CARD_POLICY.jobPriority).toBeGreaterThan(0);
  });
});

describe('ogPrerenderable — окно «живых» объектов', () => {
  it('райд: старт не раньше 14 сут. назад', () => {
    expect(ogPrerenderable({ kind: 'ride', facts: { startsAt: ago(14) } }, NOW)).toBe(true);
    expect(ogPrerenderable({ kind: 'ride', facts: { startsAt: ago(14, -1) } }, NOW)).toBe(false);
    expect(ogPrerenderable({ kind: 'ride', facts: { startsAt: ago(-3) } }, NOW)).toBe(true);
  });

  it('гонка: окно закрылось не раньше 30 сут. назад', () => {
    expect(ogPrerenderable({ kind: 'race', facts: { windowEndsAt: ago(30) } }, NOW)).toBe(true);
    expect(ogPrerenderable({ kind: 'race', facts: { windowEndsAt: ago(30, -1) } }, NOW)).toBe(
      false,
    );
  });

  it('старт календаря: последний день (Минск) не раньше 14 сут. назад; однодневный — по startsOn', () => {
    const facts = (startsOn: string, endsOn: string | null) => ({
      kind: 'calendar' as const,
      facts: { startsOn, endsOn },
    });
    expect(ogPrerenderable(facts('2026-10-01', '2026-10-15'), NOW)).toBe(true);
    expect(ogPrerenderable(facts('2026-10-01', '2026-10-14'), NOW)).toBe(false);
    expect(ogPrerenderable(facts('2026-10-15', null), NOW)).toBe(true);
    expect(ogPrerenderable(facts('2026-10-14', null), NOW)).toBe(false);
  });

  it('маршрут каталога и бренд — всегда', () => {
    expect(ogPrerenderable({ kind: 'route' }, NOW)).toBe(true);
    expect(ogPrerenderable({ kind: 'brand' }, NOW)).toBe(true);
  });
});
