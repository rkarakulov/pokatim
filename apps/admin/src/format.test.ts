import { afterEach, describe, expect, it } from 'vitest';

import { formatDateTime, formatDateTimeLong, formatLocalDate } from './format';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe('форматы времени панели — по Минску при любом поясе браузера (AC13)', () => {
  it.each(['Europe/Minsk', 'America/New_York'])('TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(formatDateTimeLong('2026-10-25T20:59:00.000Z')).toBe('25 октября 2026, 23:59');
    expect(formatDateTime('2026-10-25T20:59:00.000Z')).toBe('25.10.2026, 23:59');
    expect(formatLocalDate('2026-04-01')).toBe('1 апреля 2026');
  });
});
