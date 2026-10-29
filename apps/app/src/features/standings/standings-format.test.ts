import type {
  MySeasonStanding,
  MySeasonStandings,
  SeasonStandingCell,
  SeasonStandingsTable,
  SeasonStandingsTableRef,
} from '@pokatim/contracts';

import {
  cellResult,
  cellStatus,
  ownOrder,
  pickTable,
  placeView,
  pointsText,
  standingRow,
  tableLabel,
} from './standings-format';

const SEASON = '0190a6f4-0000-7000-8000-000000000026';
const AT = '2026-10-20T10:00:00.000Z';

const ref = (
  bikeClass: SeasonStandingsTableRef['bikeClass'],
  groupKey: SeasonStandingsTableRef['groupKey'],
): SeasonStandingsTableRef => ({ bikeClass, groupKey, riders: 3, racesTotal: 3, racesCounted: 2 });

const mine = (
  items: Partial<MySeasonStanding>[],
  computedAt: string | null = AT,
): MySeasonStandings => ({
  seasonId: SEASON,
  computedAt,
  races: [],
  items: items.map((item) => ({
    bikeClass: 'road',
    groupKey: 'm_u40',
    order: 0,
    place: 1,
    tied: false,
    points: 100,
    riders: 3,
    racesTotal: 1,
    racesCounted: 1,
    raceIds: [],
    cells: [],
    ...item,
  })),
});

const table = (overrides: Partial<SeasonStandingsTable> = {}): SeasonStandingsTable => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  computedAt: AT,
  racesTotal: 1,
  racesCounted: 1,
  riders: 1,
  races: [],
  items: [],
  nextCursor: null,
  ...overrides,
});

const cell = (overrides: Partial<SeasonStandingCell> = {}): SeasonStandingCell => ({
  raceId: '0190a6f4-0000-7000-8000-000000000101',
  place: 2,
  tied: false,
  outcome: 'placed',
  points: 85,
  counted: true,
  ...overrides,
});

describe('место и очки', () => {
  it('ничья — «=6», для скринридера «6-е место поровну»', () => {
    expect(placeView(6, true)).toEqual({ text: '=6', a11y: '6-е место поровну' });
    expect(placeView(4, false)).toEqual({ text: '4', a11y: '4' });
  });

  it('очки — множественное число', () => {
    expect(pointsText(1)).toBe('1 очко');
    expect(pointsText(2)).toBe('2 очка');
    expect(pointsText(185)).toBe('185 очков');
    expect(pointsText(0)).toBe('0 очков');
  });

  it('подпись таблицы — «{группа} · {класс}»', () => {
    expect(tableLabel('m_u40', 'road')).toBe('Мужчины до 40 · Шоссе');
    expect(tableLabel('overall', 'gravel')).toBe('Общий зачёт · Гравий');
  });
});

describe('строка таблицы', () => {
  const row = {
    order: 5,
    place: 6,
    tied: true,
    riderName: null,
    riderPublicId: null,
    riderAvatar: null,
    points: 54,
    cells: [],
  };

  it('без имени — «Участник»; своя — «Вы»; подпись a11y', () => {
    expect(standingRow(row, false)).toEqual({
      place: '=6',
      who: 'Участник',
      points: '54 очка',
      a11y: '6-е место поровну, Участник, 54 очка',
      profileA11y: null,
    });
    expect(standingRow({ ...row, riderName: 'Анна К.' }, true).who).toBe('Вы');
    expect(standingRow({ ...row, riderName: 'Анна К.', tied: false }, false).a11y).toBe(
      '6, Анна К., 54 очка',
    );
  });

  it('ссылка на профиль (rider-links-in-tables) — только при riderPublicId', () => {
    expect(standingRow(row, false).profileA11y).toBeNull();
    const named = { ...row, riderName: 'Анна К.', riderPublicId: 'p'.repeat(43) };
    expect(standingRow(named, false).profileA11y).toBe(
      'Профиль райдера, Анна К., 6-е место поровну, 54 очка',
    );
    // своя строка — тоже по имени, не «Вы»
    expect(standingRow(named, true).profileA11y).toBe(
      'Профиль райдера, Анна К., 6-е место поровну, 54 очка',
    );
  });
});

describe('выбор таблицы', () => {
  const tables = [ref('road', 'm_u40'), ref('road', 'w_u40'), ref('gravel', 'overall')];

  it('по умолчанию — своя таблица из /me, иначе первая сводки', () => {
    expect(pickTable(tables, undefined, {})).toMatchObject({
      bikeClass: 'road',
      groupKey: 'm_u40',
    });
    expect(
      pickTable(tables, mine([{ bikeClass: 'gravel', groupKey: 'overall' }]), {}),
    ).toMatchObject({ bikeClass: 'gravel', groupKey: 'overall' });
  });

  it('своей таблицы нет в сводке — первая', () => {
    expect(pickTable(tables, mine([{ bikeClass: 'mtb', groupKey: 'm_u40' }]), {})).toMatchObject({
      bikeClass: 'road',
      groupKey: 'm_u40',
    });
  });

  it('выбранный класс — своя группа в нём, иначе первая группа класса', () => {
    const own = mine([{ bikeClass: 'road', groupKey: 'w_u40' }]);
    expect(pickTable(tables, own, { bikeClass: 'gravel' })).toMatchObject({
      bikeClass: 'gravel',
      groupKey: 'overall',
    });
    expect(pickTable(tables, own, { bikeClass: 'road' })).toMatchObject({ groupKey: 'w_u40' });
    expect(pickTable(tables, own, { bikeClass: 'road', groupKey: 'm_u40' })).toMatchObject({
      groupKey: 'm_u40',
    });
  });

  it('исчезнувший выбор — по умолчанию; незнакомые класс и группа (сервер новее) не показываются', () => {
    expect(pickTable(tables, undefined, { bikeClass: 'mtb', groupKey: 'w_50p' })).toMatchObject({
      bikeClass: 'road',
      groupKey: 'm_u40',
    });
    expect(pickTable([ref('unknown', 'm_u40'), ref('road', 'unknown')], undefined, {})).toBeNull();
    expect(pickTable([], undefined, {})).toBeNull();
  });

  it('варианты переключателей — классы и группы выбранного класса', () => {
    expect(pickTable(tables, undefined, {})).toMatchObject({
      classes: ['road', 'gravel'],
      groups: ['m_u40', 'w_u40'],
    });
  });
});

describe('«Вы» по order из /me (RC-11)', () => {
  const own = mine([
    { bikeClass: 'road', groupKey: 'm_u40', order: 3 },
    { bikeClass: 'gravel', groupKey: 'overall', order: 0 },
  ]);

  it('та же таблица и тот же снимок — order своей строки', () => {
    expect(ownOrder(table(), own)).toBe(3);
    expect(ownOrder(table({ bikeClass: 'gravel', groupKey: 'overall' }), own)).toBe(0);
  });

  it('другой снимок, нет /me, нет своей строки — без метки', () => {
    expect(ownOrder(table({ computedAt: '2026-10-20T10:01:00.000Z' }), own)).toBeNull();
    expect(ownOrder(table(), undefined)).toBeNull();
    expect(ownOrder(table({ groupKey: 'w_u40' }), own)).toBeNull();
    expect(ownOrder(table({ computedAt: null }), mine([{}], null))).toBeNull();
  });
});

describe('ячейка гонки', () => {
  it('место и очки; DQ — «DQ · 0»; нет строки — «—»', () => {
    expect(cellResult(cell())).toBe('2 · 85 очков');
    expect(cellResult(cell({ place: 3, tied: true, points: 75 }))).toBe('=3 · 75 очков');
    expect(cellResult(cell({ outcome: 'dq', place: null, points: 0 }))).toBe('DQ · 0');
    expect(cellResult(cell({ outcome: 'none', place: null, points: 0, counted: false }))).toBe('—');
  });

  it('статус — в зачёте / не в зачёте / нет результата; DQ — в зачёте', () => {
    expect(cellStatus(cell())).toBe('в зачёте');
    expect(cellStatus(cell({ counted: false }))).toBe('не в зачёте');
    expect(cellStatus(cell({ outcome: 'dq', place: null, points: 0 }))).toBe('в зачёте');
    expect(cellStatus(cell({ outcome: 'none', place: null, points: 0, counted: false }))).toBe(
      'нет результата',
    );
  });
});
