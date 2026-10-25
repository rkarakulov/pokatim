/// <reference types="jest" />
import type { RaceCard } from '@pokatim/contracts';

import {
  cancelMessage,
  formatRaceWindow,
  raceCardLine,
  raceClassSurfaces,
  raceHeroLine,
  raceHeroMeta,
  raceMeta,
  raceShareDescription,
} from './format';

// перенесено из features/home/format.test.ts (R8 блока 03) без смены ожиданий
const race = (overrides: Partial<RaceCard> = {}): RaceCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Гравийный коридор',
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  // 4 октября 00:00 — 12 октября 23:59 по Минску (UTC+3)
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  ...overrides,
});

/** «Сейчас» по UTC: 2026-10-01 12:00 UTC = 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

// перевод времени — только по Минску: пояс процесса (устройства) не должен влиять (§4.7)
describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])(
  'подписи гонки (Главная) в TZ=%s',
  (tz) => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = tz;
    });
    afterAll(() => {
      process.env.TZ = original;
    });

    describe('formatRaceWindow', () => {
      it('один месяц — «4–12» + «октября»; текущий год без года', () => {
        expect(formatRaceWindow(race().windowStartsAt, race().windowEndsAt, NOW)).toEqual({
          value: '4–12',
          unit: 'октября',
        });
      });

      it('граница суток Минска: 21:00 UTC — уже следующий день', () => {
        expect(formatRaceWindow('2026-10-04T21:00:00Z', '2026-10-04T21:30:00Z', NOW)).toEqual({
          value: '5',
          unit: 'октября',
        });
      });

      it('разные месяцы — «28 сентября–3 октября»', () => {
        expect(formatRaceWindow('2026-09-27T21:00:00Z', '2026-10-03T20:59:00Z', NOW)).toEqual({
          value: '28 сентября–3 октября',
        });
      });

      it('не текущий год — с годом; разные годы — с годами', () => {
        expect(formatRaceWindow('2027-06-03T21:00:00Z', '2027-06-10T20:59:00Z', NOW)).toEqual({
          value: '4–10',
          unit: 'июня 2027',
        });
        expect(formatRaceWindow('2026-12-27T21:00:00Z', '2027-01-03T20:59:00Z', NOW)).toEqual({
          value: '28 декабря 2026–3 января 2027',
        });
      });
    });

    describe('raceHeroLine (бывш. raceLifecycleLine; фаза — с сервера)', () => {
      it('upcoming — открытие и закрытие с датой и временем Минска', () => {
        expect(raceHeroLine(race(), NOW)).toBe(
          'Окно откроется 4 октября, 00:00, закроется 12 октября в 23:59.',
        );
      });

      it('open, до закрытия больше суток — «Окно открыто до …»', () => {
        expect(raceHeroLine(race({ phase: 'open' }), new Date('2026-10-05T12:00:00Z'))).toBe(
          'Окно открыто до 12 октября, 23:59.',
        );
      });

      it('open, закрывается сегодня / завтра по Минску', () => {
        const open = race({ phase: 'open' });
        expect(raceHeroLine(open, new Date('2026-10-12T06:00:00Z'))).toBe(
          'Окно закрывается сегодня в 23:59.',
        );
        expect(raceHeroLine(open, new Date('2026-10-11T06:00:00Z'))).toBe(
          'Окно закрывается завтра в 23:59.',
        );
        // 11 октября 21:30 UTC — уже 12 октября по Минску
        expect(raceHeroLine(open, new Date('2026-10-11T21:30:00Z'))).toBe(
          'Окно закрывается сегодня в 23:59.',
        );
      });

      it("'unknown' и прочие фазы — без строки (R9)", () => {
        expect(raceHeroLine(race({ phase: 'unknown' }), NOW)).toBeNull();
        expect(raceHeroLine(race({ phase: 'closed' }), NOW)).toBeNull();
        expect(raceHeroLine(race({ phase: 'cancelled' }), NOW)).toBeNull();
      });
    });
  },
);

describe('мета героя Главной', () => {
  it('гонка: дистанция и покрытия; неизвестное покрытие — без подписи (R9)', () => {
    expect(raceMeta(race({ surfaces: ['asphalt', 'gravel'] }))).toBe('62 км · Асфальт · Гравий');
    expect(raceMeta(race({ surfaces: ['unknown', 'gravel'] }))).toBe('62 км · Гравий');
  });
});

// строки окна вкладки и карточки (AC4): фаза — с сервера, «сейчас» — только для «сегодня / завтра» и протокола
describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('строки окна в TZ=%s (AC4)', (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it('upcoming — «Окно откроется 4 октября, 00:00»; не текущий год — с годом', () => {
    expect(raceCardLine(race(), NOW)).toBe('Окно откроется 4 октября, 00:00');
    expect(raceCardLine(race({ windowStartsAt: '2027-01-09T21:00:00Z' }), NOW)).toBe(
      'Окно откроется 10 января 2027, 00:00',
    );
  });

  it('open — сегодня, завтра, позже; граница суток Минска', () => {
    const open = race({ phase: 'open' });
    expect(raceCardLine(open, new Date('2026-10-12T06:00:00Z'))).toBe(
      'Окно закрывается сегодня в 23:59.',
    );
    expect(raceCardLine(open, new Date('2026-10-11T06:00:00Z'))).toBe(
      'Окно закрывается завтра в 23:59.',
    );
    expect(raceCardLine(open, new Date('2026-10-10T20:59:00Z'))).toBe(
      'Окно открыто до 12 октября, 23:59.',
    );
    expect(raceCardLine(open, new Date('2026-10-10T21:00:00Z'))).toBe(
      'Окно закрывается завтра в 23:59.',
    );
  });

  it('closed — до плановой даты протокола «Протокол — {дата}», после — «ожидается» (Q9)', () => {
    const closed = race({ phase: 'closed' });
    expect(raceCardLine(closed, new Date('2026-10-14T08:59:00Z'))).toBe(
      'Окно закрыто. Протокол — 14 октября',
    );
    expect(raceCardLine(closed, new Date('2026-10-14T09:00:00Z'))).toBe(
      'Окно закрыто. Протокол ожидается',
    );
  });

  it("cancelled и 'unknown' — без строки (баннер / R9)", () => {
    expect(raceCardLine(race({ phase: 'cancelled' }), NOW)).toBeNull();
    expect(raceCardLine(race({ phase: 'unknown' }), NOW)).toBeNull();
  });

  it('now = null (SSR, первый рендер) — без «сегодня / завтра», даты с годом, протокол по дате', () => {
    expect(raceCardLine(race({ phase: 'open' }), null)).toBe(
      'Окно открыто до 12 октября 2026, 23:59.',
    );
    expect(raceHeroLine(race(), null)).toBe(
      'Окно откроется 4 октября 2026, 00:00, закроется 12 октября 2026 в 23:59.',
    );
    expect(raceCardLine(race({ phase: 'closed' }), null)).toBe(
      'Окно закрыто. Протокол — 14 октября 2026',
    );
    expect(formatRaceWindow(race().windowStartsAt, race().windowEndsAt, null)).toEqual({
      value: '4–12',
      unit: 'октября 2026',
    });
  });

  it('публичный экран (datesWithYear): после монтирования — «сегодня / завтра», но даты с годом', () => {
    expect(raceCardLine(race(), NOW, true)).toBe('Окно откроется 4 октября 2026, 00:00');
    expect(raceCardLine(race({ phase: 'open' }), new Date('2026-10-05T12:00:00Z'), true)).toBe(
      'Окно открыто до 12 октября 2026, 23:59.',
    );
    expect(raceCardLine(race({ phase: 'open' }), new Date('2026-10-12T06:00:00Z'), true)).toBe(
      'Окно закрывается сегодня в 23:59.',
    );
  });

  it('описание для мета и OG: даты с годом · класс · км; без ПДн', () => {
    expect(raceShareDescription(race())).toBe('4–12 октября 2026 · Гравий · 62 км');
    expect(raceShareDescription(race({ bikeClass: 'unknown' }))).toBe('4–12 октября 2026 · 62 км');
  });

  it('мета героя вкладки: дистанция, класс, окно и время закрытия по Минску', () => {
    expect(raceHeroMeta(race(), NOW)).toBe('62 км · класс «Гравий». Окно: 4–12 октября, до 23:59.');
    expect(raceHeroMeta(race({ bikeClass: 'unknown', distanceKm: 48.5 }), NOW)).toBe(
      '48,5 км. Окно: 4–12 октября, до 23:59.',
    );
  });
});

describe('подписи карточки гонки', () => {
  it('класс и покрытия; неизвестные — без своей части (R9)', () => {
    expect(raceClassSurfaces(race({ surfaces: ['gravel', 'asphalt'] }))).toBe(
      'Класс «Гравий» · покрытие: гравий · асфальт',
    );
    expect(raceClassSurfaces(race({ surfaces: ['unknown'] }))).toBe('Класс «Гравий»');
    expect(raceClassSurfaces(race({ bikeClass: 'unknown' }))).toBe('Покрытие: гравий');
    expect(raceClassSurfaces(race({ bikeClass: 'unknown', surfaces: [] }))).toBe('');
  });

  it('отмена — текст превью панели (Q13); неизвестная причина — без причины (R9)', () => {
    expect(cancelMessage('weather')).toBe(
      'Гонка отменена. Причина: Неблагоприятные погодные условия.',
    );
    expect(cancelMessage('unknown')).toBe('Гонка отменена.');
    expect(cancelMessage(null)).toBe('Гонка отменена.');
  });
});
