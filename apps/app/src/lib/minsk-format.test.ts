/// <reference types="jest" />
import {
  domainLabel,
  formatDistances,
  formatLocalRange,
  formatMinskDateTime,
  meta,
  minskLastMinuteBefore,
} from './minsk-format';

// перенесено из features/home/format.test.ts (R8 блока 03) без смены ожиданий
describe('мета героев', () => {
  it('дистанции: одна, две, несколько; дробные — с запятой', () => {
    expect(formatDistances([100])).toBe('100 км');
    expect(formatDistances([80, 120])).toBe('80 и 120 км');
    expect(formatDistances([40, 80, 120])).toBe('40, 80 и 120 км');
    expect(formatDistances([42.2])).toBe('42,2 км');
    expect(formatDistances([])).toBeNull();
  });
});

describe('даты и справочники', () => {
  const NOW = new Date('2026-10-01T12:00:00Z');

  it('год: текущий по Минску — без года; now = null (SSR) — всегда с годом', () => {
    expect(formatLocalRange('2026-04-01', '2026-10-31', NOW)).toEqual({
      value: '1 апреля–31 октября',
    });
    expect(formatLocalRange('2026-04-01', '2026-10-31', null)).toEqual({
      value: '1 апреля–31 октября 2026',
    });
    expect(formatLocalRange('2026-10-04', '2026-10-04', null)).toEqual({
      value: '4',
      unit: 'октября 2026',
    });
    // 31.12 22:00 UTC — уже 1 января по Минску: 2027 — текущий год
    expect(formatLocalRange('2027-01-05', '2027-01-07', new Date('2026-12-31T22:00:00Z'))).toEqual({
      value: '5–7',
      unit: 'января',
    });
  });

  it("справочник: 'unknown' — без подписи; мета пропускает пустые", () => {
    expect(domainLabel('domain.bikeClass', 'mtb')).toBe('МТБ');
    expect(domainLabel('domain.bikeClass', 'unknown')).toBeNull();
    expect(meta(['62 км', null, '', 'Гравий'])).toBe('62 км · Гравий');
    expect(meta([])).toBe('');
  });
});

describe('formatMinskDateTime (кофе-райды)', () => {
  const NOW = new Date('2026-10-01T12:00:00Z');

  it('день недели, дата, время по Минску; год — только не текущий; now = null — всегда', () => {
    // 4 октября 2026 10:00 Минска = 07:00 UTC, воскресенье
    expect(formatMinskDateTime('2026-10-04T07:00:00Z', NOW)).toEqual({
      date: 'Воскресенье, 4 октября',
      time: '10:00',
      full: 'Воскресенье, 4 октября, 10:00',
    });
    expect(formatMinskDateTime('2026-10-03T06:00:00Z', NOW, 'short').full).toBe(
      'Сб 3 октября, 9:00',
    );
    expect(formatMinskDateTime('2026-10-04T07:00:00Z', null).full).toBe(
      'Воскресенье, 4 октября 2026, 10:00',
    );
    expect(formatMinskDateTime('2027-01-02T07:00:00Z', NOW, 'short').date).toBe('Сб 2 января 2027');
  });

  it('полночь Минска: 21:30 UTC — уже следующий день и его день недели', () => {
    expect(formatMinskDateTime('2026-10-03T21:30:00Z', NOW).full).toBe(
      'Воскресенье, 4 октября, 0:30',
    );
  });
});

describe('исключающая граница (B6 смоука dev)', () => {
  it('полночь по Минску — последняя включённая минута предыдущего дня', () => {
    expect(minskLastMinuteBefore('2026-11-09T21:00:00Z', null)).toMatchObject({
      date: '9 ноября 2026',
      time: '23:59',
    });
  });

  it('граница внутри минуты — сама эта минута; ровно на минуте — минута раньше', () => {
    expect(minskLastMinuteBefore('2026-11-09T18:30:30Z', null).time).toBe('21:30');
    expect(minskLastMinuteBefore('2026-11-09T18:30:00Z', null).time).toBe('21:29');
  });
});
