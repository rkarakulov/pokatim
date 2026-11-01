import { describe, expect, it } from 'vitest';

import { activeDayKey, activeDayTtlSec } from './active-day';

describe('активный день (K12, P7): ключ и срок', () => {
  it('ключ — uid и дата Минска', () => {
    expect(activeDayKey('0190a6f4-0000-7000-8000-000000000001', '2026-10-22')).toBe(
      'active-day:0190a6f4-0000-7000-8000-000000000001:2026-10-22',
    );
  });

  it('срок — до начала следующих суток по Минску (21:00 UTC) плюс час', () => {
    // 12:00 по Минску — до полуночи 12 ч
    expect(activeDayTtlSec(new Date('2026-10-22T09:00:00Z'))).toBe(12 * 3600 + 3600);
    // 23:59:59 по Минску — секунда
    expect(activeDayTtlSec(new Date('2026-10-22T20:59:59Z'))).toBe(1 + 3600);
    // ровно полночь Минска — новые сутки целиком
    expect(activeDayTtlSec(new Date('2026-10-22T21:00:00Z'))).toBe(24 * 3600 + 3600);
    // доли секунды округляются вверх
    expect(activeDayTtlSec(new Date('2026-10-22T20:59:59.500Z'))).toBe(1 + 3600);
  });
});
