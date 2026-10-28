import { describe, expect, it } from 'vitest';

import {
  formatElapsed,
  formatLocalRange,
  formatPlace,
  heroDateText,
  minskDateTime,
} from './format.ts';

const NOW = new Date('2026-10-05T09:00:00Z');

describe('formatElapsed', () => {
  it('всегда ч:мм:сс, часы без ведущего нуля и без ограничения', () => {
    expect(formatElapsed(1939)).toBe('0:32:19');
    expect(formatElapsed(3725)).toBe('1:02:05');
    expect(formatElapsed(90061)).toBe('25:01:01');
  });

  it('дробные секунды отбрасываются, отрицательные — ноль', () => {
    expect(formatElapsed(59.9)).toBe('0:00:59');
    expect(formatElapsed(-5)).toBe('0:00:00');
  });
});

describe('formatPlace', () => {
  it('место; при ничьей — «=N»', () => {
    expect(formatPlace(3, false)).toBe('3');
    expect(formatPlace(3, true)).toBe('=3');
  });
});

describe('formatLocalRange', () => {
  it('один месяц текущего года — без года', () => {
    expect(heroDateText(formatLocalRange('2026-10-04', '2026-10-12', NOW))).toBe('4–12 октября');
  });

  it('now = null — всегда с годом', () => {
    expect(heroDateText(formatLocalRange('2026-10-04', '2026-10-12', null))).toBe(
      '4–12 октября 2026',
    );
    expect(heroDateText(formatLocalRange('2026-09-28', '2026-10-03', null))).toBe(
      '28 сентября–3 октября 2026',
    );
    expect(heroDateText(formatLocalRange('2026-10-04', '2026-10-04', null))).toBe('4 октября 2026');
  });

  it('разные годы — год у обеих дат', () => {
    expect(heroDateText(formatLocalRange('2026-12-30', '2027-01-02', NOW))).toBe(
      '30 декабря 2026–2 января 2027',
    );
  });
});

describe('minskDateTime', () => {
  it('момент UTC по Минску: дата и время', () => {
    expect(minskDateTime('2026-10-04T20:59:00Z', NOW)).toEqual({
      localDate: '2026-10-04',
      date: '4 октября',
      time: '23:59',
    });
  });
});
