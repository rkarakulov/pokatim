import { afterEach, describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatDateTimeLong,
  formatElapsed,
  formatKmFromMeters,
  formatKmPrecise,
  formatLocalDate,
} from './format';

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

describe('длина маршрута', () => {
  it('метры → км с одним знаком после запятой', () => {
    expect(formatKmFromMeters(86_012).replace('\u00a0', ' ')).toBe('86,0 км');
    expect(formatKmFromMeters(62_050).replace('\u00a0', ' ')).toBe('62,1 км');
    expect(formatKmFromMeters(1_234_560).replace(/\s/g, ' ')).toBe('1 234,6 км');
  });

  it('точная дистанция ячейки рядов — два знака: соседние ячейки ~45 м различимы (B11)', () => {
    expect(formatKmPrecise(45).replace('\u00a0', ' ')).toBe('0,05 км');
    expect(formatKmPrecise(90).replace('\u00a0', ' ')).toBe('0,09 км');
    expect(formatKmPrecise(135).replace('\u00a0', ' ')).toBe('0,14 км');
    expect(formatKmPrecise(3000).replace('\u00a0', ' ')).toBe('3,00 км');
  });
});

describe('время заезда', () => {
  it('секунды → всегда «ч:мм:сс», как в приложении (B15)', () => {
    expect(formatElapsed(3723)).toBe('1:02:03');
    expect(formatElapsed(1939)).toBe('0:32:19');
    expect(formatElapsed(59)).toBe('0:00:59');
    expect(formatElapsed(36_000)).toBe('10:00:00');
    expect(formatElapsed(90_061)).toBe('25:01:01');
  });
});
