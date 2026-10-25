/// <reference types="jest" />
import { domainLabel, formatDistances, formatLocalRange, meta } from './minsk-format';

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
