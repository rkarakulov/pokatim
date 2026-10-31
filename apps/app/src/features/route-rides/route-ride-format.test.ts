/// <reference types="jest" />
import {
  BEST_ID,
  leaderboard,
  leaderboardMe,
  leaderboardRow,
  PREVIOUS_ID,
  RIDER_PUBLIC_ID,
  rideDetail,
  rideRow,
  ROUTE_ID,
  RIDE_ID,
} from '../../__tests__/route-rides-fixtures';
import {
  formatDeltaSec,
  isPendingCheck,
  leaderboardMeView,
  leaderboardRowView,
  OTHERS_CARD_ROWS,
  othersShown,
  othersTruncated,
  ownInRows,
  rideDayText,
  routeCardPath,
  routeRideComparisonLines,
  routeRideFailureText,
  routeRideOriginText,
  routeRidePath,
  routeRideOthersPath,
  routeRidePickPath,
  routeRideReasonText,
  routeRideRowView,
  routeRideSourceLabel,
  routeRidesSummary,
  routeRideStatusPill,
  routeRideTrackLines,
  VISIBLE_ROWS,
} from './route-ride-format';

/** 28 октября 2026 — даты заездов текущего года без года. */
const NOW = new Date('2026-10-28T09:00:00Z');
/** 5 октября 2026, 10:00 по Минску. */
const EARLIER = '2026-10-05T07:00:00.000Z';

describe('статус заезда по маршруту (route-rides-02)', () => {
  it('пилюля — подпись и тон всех статусов и unknown', () => {
    expect(routeRideStatusPill('queued')).toEqual({ label: 'В очереди', tone: 'neutral' });
    expect(routeRideStatusPill('checking')).toEqual({ label: 'Проверяем', tone: 'warning' });
    expect(routeRideStatusPill('passed')).toEqual({ label: 'Пройден', tone: 'success' });
    expect(routeRideStatusPill('not_passed')).toEqual({ label: 'Не пройден', tone: 'error' });
    expect(routeRideStatusPill('failed')).toEqual({
      label: 'Не удалось проверить',
      tone: 'error',
    });
    expect(routeRideStatusPill('unknown')).toEqual({
      label: 'Статус неизвестен',
      tone: 'neutral',
    });
  });

  it('проверка идёт — только queued и checking', () => {
    expect(isPendingCheck('queued')).toBe(true);
    expect(isPendingCheck('checking')).toBe(true);
    for (const status of ['passed', 'not_passed', 'failed', 'unknown'] as const) {
      expect(isPendingCheck(status)).toBe(false);
    }
  });

  it('причина — тексты гонок; null и unknown — без строки (RC-8)', () => {
    expect(routeRideReasonText('off_corridor')).toMatch(/коридор/);
    expect(routeRideReasonText('no_finish')).toBe('Нет финиша: трек не входит в ворота финиша');
    expect(routeRideReasonText('unknown')).toBeNull();
    expect(routeRideReasonText(null)).toBeNull();
  });

  it('сбой проверки — текст кода; null и unknown — общий', () => {
    expect(routeRideFailureText('storage')).toBe('Трек временно недоступен');
    expect(routeRideFailureText('timeout')).toBe('Проверка не уложилась во время');
    expect(routeRideFailureText('unreadable')).toBe('Трек не читается');
    expect(routeRideFailureText('corridor_invalid')).toBe(
      'Линию маршрута не удалось подготовить к проверке',
    );
    expect(routeRideFailureText('error')).toBe('Ошибка проверки');
    expect(routeRideFailureText('unknown')).toBe('Ошибка проверки');
    expect(routeRideFailureText(null)).toBe('Ошибка проверки');
  });

  it('источник: Garmin, Wahoo, Файл; unknown — Файл', () => {
    expect(routeRideSourceLabel('garmin')).toBe('Garmin');
    expect(routeRideSourceLabel('wahoo')).toBe('Wahoo');
    expect(routeRideSourceLabel('upload')).toBe('Файл');
    expect(routeRideSourceLabel('unknown')).toBe('Файл');
  });
});

describe('сводка и строки блока «Мои заезды»', () => {
  it('сводка: 0 — нет; с лучшим — время; без лучшего — только число', () => {
    expect(routeRidesSummary({ count: 0, passedCount: 0, best: null })).toBeNull();
    expect(
      routeRidesSummary({
        count: 3,
        passedCount: 1,
        best: { id: BEST_ID, elapsedSec: 7_477, rideStartedAt: EARLIER },
      }),
    ).toBe('Заездов: 3 · лучший 2:04:37');
    expect(routeRidesSummary({ count: 2, passedCount: 0, best: null })).toBe('Заездов: 2');
  });

  it('строка пройденного лучшего: пилюли, время, дата и источник, подпись a11y', () => {
    const view = routeRideRowView(rideRow({ isBest: true }), NOW);
    expect(view.pill).toEqual({ label: 'Пройден', tone: 'success' });
    expect(view.best).toBe(true);
    expect(view.time).toBe('2:04:37');
    expect(view.meta).toBe('12 октября, 09:30 · Garmin');
    expect(view.a11y).toBe('Пройден · Лучший · 2:04:37 · 12 октября, 09:30 · Garmin');
  });

  it('время и «Лучший» — только у passed; now = null — без даты; источник unknown — Файл', () => {
    const notPassed = routeRideRowView(
      rideRow({ status: 'not_passed', reason: 'off_corridor', elapsedSec: 10, isBest: true }),
      NOW,
    );
    expect(notPassed.best).toBe(false);
    expect(notPassed.time).toBeNull();
    const ssr = routeRideRowView(
      rideRow({ activity: { ...rideRow().activity, source: 'unknown' } }),
      null,
    );
    expect(ssr.meta).toBe('Файл');
    expect(routeRideRowView(rideRow({ elapsedSec: null }), NOW).time).toBeNull();
  });

  it('видимых строк — 5', () => {
    expect(VISIBLE_ROWS).toBe(5);
  });
});

describe('сравнение со своими заездами (R2, RC-7)', () => {
  it('дельта: знак сервера, минус U+2212, 0 — без знака, часы', () => {
    expect(formatDeltaSec(42)).toBe('+0:42');
    expect(formatDeltaSec(-65)).toBe('−1:05');
    expect(formatDeltaSec(0)).toBe('0:00');
    expect(formatDeltaSec(3_725)).toBe('+1:02:05');
  });

  it('пройден и лучший — «Это ваш лучший заезд»; предыдущий — дельта и дата', () => {
    expect(routeRideComparisonLines(rideDetail(), NOW)).toEqual(['Это ваш лучший заезд']);
    expect(
      routeRideComparisonLines(
        rideDetail({
          comparison: {
            best: { id: RIDE_ID, elapsedSec: 7_477, rideStartedAt: EARLIER },
            isBest: true,
            deltaToBestSec: 0,
            previous: { id: PREVIOUS_ID, elapsedSec: 7_542, rideStartedAt: EARLIER },
            deltaToPreviousSec: -65,
          },
        }),
        NOW,
      ),
    ).toEqual(['Это ваш лучший заезд', 'К предыдущему: −1:05 · 5 октября']);
  });

  it('пройден не лучшим — «К лучшему: +0:42»; без предыдущего — одна строка', () => {
    expect(
      routeRideComparisonLines(
        rideDetail({
          comparison: {
            best: { id: BEST_ID, elapsedSec: 7_435, rideStartedAt: EARLIER },
            isBest: false,
            deltaToBestSec: 42,
            previous: null,
            deltaToPreviousSec: null,
          },
        }),
        NOW,
      ),
    ).toEqual(['К лучшему: +0:42']);
  });

  it('не пройден — «Лучший: время · дата», если есть; иначе ничего', () => {
    const best = { id: BEST_ID, elapsedSec: 7_477, rideStartedAt: EARLIER };
    const notPassed = (withBest: boolean) =>
      rideDetail({
        status: 'not_passed',
        reason: 'off_corridor',
        elapsedSec: null,
        comparison: {
          best: withBest ? best : null,
          isBest: false,
          deltaToBestSec: null,
          previous: null,
          deltaToPreviousSec: null,
        },
      });
    expect(routeRideComparisonLines(notPassed(true), NOW)).toEqual(['Лучший: 2:04:37 · 5 октября']);
    expect(routeRideComparisonLines(notPassed(false), NOW)).toEqual([]);
  });
});

describe('текстовая альтернатива трека (RC-9)', () => {
  it('проверка идёт или разметка pending — «проверяется»', () => {
    const pending = 'Трек проверяется — участки вне коридора появятся после проверки';
    expect(routeRideTrackLines(rideDetail({ status: 'queued' }), 'ready', 0)).toEqual([pending]);
    expect(routeRideTrackLines(rideDetail(), 'pending', 0)).toEqual([pending]);
  });

  it('не пройден: «Где сход», если участки есть; причины здесь нет — она в вердикте экрана (ревью pass 1)', () => {
    const detail = rideDetail({ status: 'not_passed', reason: 'off_corridor', elapsedSec: null });
    expect(routeRideTrackLines(detail, 'ready', 2)).toEqual(['Где сход — пунктиром на карте']);
    expect(routeRideTrackLines(detail, 'ready', 0)).toEqual([]);
  });

  it('разметка недоступна — отдельная строка; пройден с разметкой — ничего', () => {
    expect(routeRideTrackLines(rideDetail(), 'unavailable', 0)).toEqual([
      'Разметка участков для этого заезда недоступна',
    ]);
    expect(routeRideTrackLines(rideDetail(), 'ready', 0)).toEqual([]);
  });
});

describe('адреса (A5)', () => {
  it('выбор, результат и карточка — с ?mine=1 для своего маршрута', () => {
    expect(routeRidePickPath(ROUTE_ID, false)).toBe(`/routes/pick/${ROUTE_ID}`);
    expect(routeRidePickPath(ROUTE_ID, true)).toBe(`/routes/pick/${ROUTE_ID}?mine=1`);
    expect(routeRidePath(ROUTE_ID, RIDE_ID, false)).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`);
    expect(routeRidePath(ROUTE_ID, RIDE_ID, true)).toBe(
      `/routes/rides/${ROUTE_ID}/${RIDE_ID}?mine=1`,
    );
    expect(routeCardPath(ROUTE_ID, false)).toBe(`/routes/${ROUTE_ID}`);
    expect(routeCardPath(ROUTE_ID, true)).toBe(`/routes/mine/${ROUTE_ID}`);
  });

  it('полный список «Другие» (route-rides-04) — id кодируется', () => {
    expect(routeRideOthersPath(ROUTE_ID)).toBe(`/routes/others/${ROUTE_ID}`);
    expect(routeRideOthersPath('a b/c')).toBe('/routes/others/a%20b%2Fc');
  });
});

describe('происхождение заезда (route-rides-03)', () => {
  it('auto — «Проверен автоматически»; manual и незнакомое — без строки', () => {
    expect(routeRideOriginText('auto')).toBe('Проверен автоматически');
    expect(routeRideOriginText('manual')).toBeNull();
    expect(routeRideOriginText('unknown')).toBeNull();
  });
});

describe('строки таблицы «Другие на маршруте» (route-rides-04)', () => {
  it('блок карточки — 5 строк', () => {
    expect(OTHERS_CARD_ROWS).toBe(5);
  });

  it('день заезда — без времени суток; не текущий год и до монтирования — с годом', () => {
    expect(rideDayText('2026-10-04', NOW)).toBe('4 октября');
    expect(rideDayText('2025-10-04', NOW)).toBe('4 октября 2025');
    expect(rideDayText('2026-10-04', null)).toBe('4 октября 2026');
  });

  it('чужая без карточки — «Участник», без ссылки на профиль', () => {
    expect(leaderboardRowView(leaderboardRow({ place: 3 }), NOW)).toEqual({
      own: false,
      place: '3',
      who: 'Участник',
      time: '2:04:37',
      day: '4 октября',
      a11y: '3, Участник, 2:04:37, 4 октября',
      profileA11y: null,
      ownA11y: null,
    });
  });

  it('чужая публичная — имя и метка ссылки на профиль', () => {
    const view = leaderboardRowView(
      leaderboardRow({ place: 2, riderName: 'Анна К.', riderPublicId: RIDER_PUBLIC_ID }),
      NOW,
    );
    expect(view.who).toBe('Анна К.');
    expect(view.profileA11y).toBe('Профиль райдера, Анна К., 2, 2:04:37, 4 октября');
    expect(view.ownA11y).toBeNull();
  });

  it('своя (`rideId`) — «Вы», переход к своему заезду; ссылка на профиль — по имени', () => {
    const view = leaderboardRowView(
      leaderboardRow({
        place: 1,
        rideId: RIDE_ID,
        riderName: 'Анна К.',
        riderPublicId: RIDER_PUBLIC_ID,
      }),
      NOW,
    );
    expect(view.own).toBe(true);
    expect(view.who).toBe('Вы');
    expect(view.ownA11y).toBe('Ваш заезд, 1, 2:04:37, 4 октября');
    expect(view.profileA11y).toBe('Профиль райдера, Анна К., 1, 2:04:37, 4 октября');
  });

  it('своя строка вне списка (`me`) — «Вы» со своим местом', () => {
    expect(leaderboardMeView(leaderboardMe(), NOW)).toEqual({
      own: true,
      place: '7',
      who: 'Вы',
      time: '2:15:00',
      day: '12 октября',
      a11y: '7, Вы, 2:15:00, 12 октября',
      profileA11y: null,
      ownA11y: 'Ваш заезд, 7, 2:15:00, 12 октября',
    });
  });

  it('своя в списке — по `rideId` (RC-B1)', () => {
    expect(ownInRows([leaderboardRow(), leaderboardRow({ place: 2 })])).toBe(false);
    expect(ownInRows([leaderboardRow(), leaderboardRow({ place: 2, rideId: RIDE_ID })])).toBe(true);
  });

  it('скрыты строки — только кроме своей, показанной отдельно (RC-B2)', () => {
    const rows = [leaderboardRow(), leaderboardRow({ place: 2 })];
    expect(othersTruncated(leaderboard(rows))).toBe(false);
    expect(othersTruncated(leaderboard(rows, { total: 3 }))).toBe(true);
    expect(othersTruncated(leaderboard(rows, { total: 3, me: leaderboardMe() }))).toBe(false);
    expect(othersTruncated(leaderboard(rows, { total: 4, me: leaderboardMe() }))).toBe(true);
    expect(othersTruncated(leaderboard([], { total: 1, me: leaderboardMe() }))).toBe(false);
    const own = [leaderboardRow(), leaderboardRow({ place: 2, rideId: RIDE_ID })];
    expect(othersTruncated(leaderboard(own, { total: 3, me: leaderboardMe() }))).toBe(true);
  });

  it('показано строк — `rows` и своя вне `rows` (сноска «Показаны лучшие N из M»)', () => {
    const rows = [leaderboardRow(), leaderboardRow({ place: 2 })];
    expect(othersShown(leaderboard(rows))).toBe(2);
    expect(othersShown(leaderboard(rows, { me: leaderboardMe() }))).toBe(3);
    const own = [leaderboardRow(), leaderboardRow({ place: 2, rideId: RIDE_ID })];
    expect(othersShown(leaderboard(own, { me: leaderboardMe() }))).toBe(2);
  });
});
