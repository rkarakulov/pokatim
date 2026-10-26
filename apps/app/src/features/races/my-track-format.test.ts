/// <reference types="jest" />
import type { MyAttempt } from '@pokatim/contracts';

import { myTrackLines, myTrackMapLabel, pickTrackAttempt } from './my-track-format';

const AT = '2026-10-25T06:00:00.000Z';
const attempt = (id: string, overrides: Partial<MyAttempt> = {}): MyAttempt => ({
  id,
  origin: 'auto',
  status: 'counted',
  reasons: [],
  segment: {
    startedAt: AT,
    finishedAt: AT,
    elapsedSec: 3600,
    distanceM: 30_000,
    offCorridorM: 0,
    offCorridorShare: 0,
    maxExcursionM: 0,
    coverage: 1,
  },
  isBest: false,
  activity: { id, startedAt: AT, source: 'upload', elapsedSec: 3700, distanceM: 31_000 },
  createdAt: AT,
  checkedAt: AT,
  ...overrides,
});
const withOff = (overrides: Partial<MyAttempt> = {}) =>
  attempt('a', {
    status: 'rejected',
    reasons: ['off_corridor'],
    segment: { ...attempt('a').segment!, offCorridorM: 820, maxExcursionM: 640 },
    ...overrides,
  });

describe('выбор попытки на карте (maps-02, RC-9)', () => {
  it('по умолчанию — лучшая, иначе новая (сервер — новые сверху); выбранная исчезла — снова по умолчанию', () => {
    const list = [attempt('new'), attempt('best', { isBest: true }), attempt('old')];
    expect(pickTrackAttempt(list, null)?.id).toBe('best');
    expect(pickTrackAttempt([attempt('new'), attempt('old')], null)?.id).toBe('new');
    expect(pickTrackAttempt(list, 'old')?.id).toBe('old');
    expect(pickTrackAttempt(list, 'gone')?.id).toBe('best');
    expect(pickTrackAttempt([], null)).toBeNull();
  });
});

describe('текстовая альтернатива трека (RC-7)', () => {
  it('засчитано без схода — «Весь сегмент в коридоре»; со сходом — метры', () => {
    expect(myTrackLines(attempt('a'), 'ready', 0)).toEqual(['Весь сегмент в коридоре']);
    expect(
      myTrackLines(
        attempt('a', {
          segment: { ...attempt('a').segment!, offCorridorM: 120, maxExcursionM: 80 },
        }),
        'ready',
        2,
      ),
    ).toEqual(['Вне коридора 120 м, самый длинный выход 80 м']);
  });

  it('отказ с сегментом — метры, причина и «Где сход — пунктиром», если участки есть', () => {
    expect(myTrackLines(withOff(), 'ready', 3)).toEqual([
      'Вне коридора 820 м, самый длинный выход 640 м',
      'Сход с коридора: больше 2 % вне коридора или выход длиннее 500 м',
      'Где сход — пунктиром на карте',
    ]);
    expect(myTrackLines(withOff(), 'ready', 0)).toEqual([
      'Вне коридора 820 м, самый длинный выход 640 м',
      'Сход с коридора: больше 2 % вне коридора или выход длиннее 500 м',
    ]);
  });

  it('проверка идёт — только «проверяется»; разметки нет — причина и «недоступна»', () => {
    expect(myTrackLines(attempt('a', { status: 'checking', segment: null }), 'pending', 0)).toEqual(
      ['Трек проверяется — участки вне коридора появятся после проверки'],
    );
    expect(
      myTrackLines(
        attempt('a', { status: 'rejected', reasons: ['implausible'], segment: null }),
        'unavailable',
        0,
      ),
    ).toEqual(['Трек неправдоподобен', 'Разметка участков для этой попытки недоступна']);
    expect(myTrackLines(attempt('a'), 'unknown', 0)).toEqual([
      'Весь сегмент в коридоре',
      'Разметка участков для этой попытки недоступна',
    ]);
  });

  it('исключённая — как отказ с сегментом без причины', () => {
    expect(myTrackLines(withOff({ status: 'excluded', reasons: [] }), 'ready', 1)).toEqual([
      'Вне коридора 820 м, самый длинный выход 640 м',
    ]);
  });

  it('подпись a11y карты включает строки трека', () => {
    expect(myTrackMapLabel('Карта маршрута', ['Весь сегмент в коридоре'])).toBe(
      'Карта маршрута. Ваш трек: Весь сегмент в коридоре',
    );
  });
});
