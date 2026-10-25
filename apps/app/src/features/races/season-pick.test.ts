/// <reference types="jest" />
import type { SeasonCard } from '@pokatim/contracts';

import { pickSeason } from './season-pick';

const season = (name: string, phase: SeasonCard['phase']): SeasonCard => ({
  id: `0190a6f4-0000-7000-8000-00000000000${name.length % 10}`,
  name,
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase,
});

describe('pickSeason (R10)', () => {
  const s2028 = season('Сезон 2028', 'upcoming');
  const s2027 = season('Сезон 2027', 'upcoming');
  const s2026 = season('Сезон 2026', 'current');
  const s2025 = season('Сезон 2025', 'finished');
  const s2024 = season('Сезон 2024', 'finished');

  it('текущий — он', () => {
    expect(pickSeason(s2026, [s2027, s2026, s2025])).toBe(s2026);
  });

  it('вне сезона — ближайший предстоящий (список новыми сверху)', () => {
    expect(pickSeason(null, [s2028, s2027, s2025])).toBe(s2027);
  });

  it('предстоящих нет — последний завершённый', () => {
    expect(pickSeason(null, [s2025, s2024])).toBe(s2025);
  });

  it("сезонов нет или только 'unknown' — null (кнопки нет)", () => {
    expect(pickSeason(null, [])).toBeNull();
    expect(pickSeason(null, [season('Сезон X', 'unknown')])).toBeNull();
  });
});
