/// <reference types="jest" />
import type { Achievement } from '@pokatim/contracts';

import {
  achievementA11y,
  achievementCondition,
  achievementItemPath,
  achievementKey,
  achievementObjectText,
  achievementTitle,
  badgeCount,
  catalogEntry,
  displayLevel,
  factDateText,
  flashKey,
  flashQueue,
  isLevelUp,
  knownItems,
  levelLabel,
  publicItems,
  seenTarget,
  shareRaceId,
} from './achievement-catalog';

const RACE = '0190a6f4-0000-7000-8000-000000000201';
const ROUTE = '0190a6f4-0000-7000-8000-000000000301';

const item = (overrides: Partial<Achievement> = {}): Achievement => ({
  code: 'race_first_finish',
  object: { kind: 'race', id: RACE, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  level: null,
  seen: true,
  ...overrides,
});

describe('knownItems (RC-8)', () => {
  it('отбрасывает незнакомые коды старой сборки, порядок сервера сохраняется', () => {
    const items = [
      item({ code: 'race_win' }),
      item({ code: 'unknown' }),
      item({ code: 'route_first' }),
    ];
    expect(knownItems(items).map((a) => a.code)).toEqual(['race_win', 'route_first']);
  });
});

describe('flashQueue (A5)', () => {
  it('только неувиденные известные — от старых к новым (обратный порядок ответа)', () => {
    // ответ сервера — от новых фактов к старым
    const items = [
      item({ code: 'races_5', seen: false }),
      item({ code: 'unknown', seen: false }),
      item({ code: 'race_win', seen: true }),
      item({ code: 'race_podium', seen: false }),
      item({ code: 'race_first_finish', seen: false }),
    ];
    expect(flashQueue(items).map((a) => a.code)).toEqual([
      'race_first_finish',
      'race_podium',
      'races_5',
    ]);
  });

  it('исключает уже показанные в этом запуске (сбой `seen` не зацикливает вспышку)', () => {
    const items = [
      item({ code: 'race_win', seen: false }),
      item({ code: 'ride_first', seen: false }),
    ];
    expect(flashQueue(items, new Set(['race_win:'])).map((a) => a.code)).toEqual(['ride_first']);
  });

  it('ключ сессии — код и уровень (RC-L4): повышение в том же запуске вспыхивает, тот же уровень — нет', () => {
    const silver = item({ code: 'races_5', level: 'silver', seen: false });
    expect(flashKey(silver)).toBe('races_5:silver');
    expect(flashKey(item({ code: 'race_win' }))).toBe('race_win:');
    expect(flashQueue([silver], new Set(['races_5:bronze'])).map(flashKey)).toEqual([
      'races_5:silver',
    ]);
    expect(flashQueue([silver], new Set(['races_5:silver']))).toEqual([]);
  });

  it('всё просмотрено или пусто — очереди нет', () => {
    expect(flashQueue([item()])).toEqual([]);
    expect(flashQueue([])).toEqual([]);
  });
});

describe('shareRaceId (A6, AC11)', () => {
  it.each(['race_first_finish', 'race_podium', 'race_win', 'races_5'] as const)(
    '%s — гонка объекта',
    (code) => {
      const [known] = knownItems([item({ code })]);
      expect(shareRaceId(known!)).toBe(RACE);
    },
  );

  it.each(['route_first', 'routes_5', 'ride_first', 'ride_organizer', 'rides_10'] as const)(
    '%s — без шеринга',
    (code) => {
      const [known] = knownItems([
        item({ code, object: { kind: 'route', id: ROUTE, title: 'Петля' } }),
      ]);
      expect(shareRaceId(known!)).toBeNull();
    },
  );

  it('незнакомый вид объекта — без шеринга', () => {
    const [known] = knownItems([item({ object: { kind: 'unknown', id: RACE, title: 'Что-то' } })]);
    expect(shareRaceId(known!)).toBeNull();
  });
});

describe('подписи', () => {
  it('название, объект по виду, дата факта с годом', () => {
    expect(achievementTitle('race_podium')).toBe('Подиум');
    expect(achievementObjectText(item().object)).toBe('Гонка «Гонка у озера»');
    expect(achievementObjectText({ kind: 'route', id: ROUTE, title: 'Петля' })).toBe(
      'Маршрут «Петля»',
    );
    expect(achievementObjectText({ kind: 'ride', id: ROUTE, title: 'Кофе' })).toBe(
      'Кофе-райд «Кофе»',
    );
    expect(achievementObjectText({ kind: 'unknown', id: ROUTE, title: 'X' })).toBe('X');
    expect(factDateText('2026-05-02')).toBe('2 мая 2026');
  });

  it('подпись a11y: название, объект и дата', () => {
    const [known] = knownItems([item({ code: 'race_win' })]);
    expect(achievementA11y(known!)).toBe('Достижение «Победа»: Гонка «Гонка у озера», 2 мая 2026');
  });

  it('подпись a11y счётного — с уровнем; старый API (без уровня) — бронза', () => {
    const [silver, v1] = knownItems([
      item({ code: 'races_5', level: 'silver' }),
      item({ code: 'races_5', level: null }),
    ]);
    expect(achievementA11y(silver!)).toBe(
      'Достижение «Гонщик», серебро: Гонка «Гонка у озера», 2 мая 2026',
    );
    expect(achievementA11y(v1!)).toBe(
      'Достижение «Гонщик», бронза: Гонка «Гонка у озера», 2 мая 2026',
    );
  });
});

describe('уровни (L6, RC-L8)', () => {
  it('displayLevel: счётное без уровня (старый API) — бронза; незнакомый — нет; разовое — нет', () => {
    expect(displayLevel('races_5', 'silver')).toBe('silver');
    expect(displayLevel('races_5', null)).toBe('bronze');
    expect(displayLevel('rides_10', 'unknown')).toBeNull();
    expect(displayLevel('race_win', null)).toBeNull();
    expect(displayLevel('race_win', 'gold')).toBeNull();
  });

  it('badgeCount: порог уровня из контрактов; незнакомый уровень и разовые — без числа', () => {
    expect(badgeCount('races_5', 'bronze')).toBe(5);
    expect(badgeCount('races_5', 'silver')).toBe(15);
    expect(badgeCount('routes_5', 'gold')).toBe(30);
    expect(badgeCount('rides_10', null)).toBe(10);
    expect(badgeCount('rides_10', 'gold')).toBe(50);
    expect(badgeCount('rides_10', 'unknown')).toBeUndefined();
    expect(badgeCount('race_win', null)).toBeUndefined();
  });

  it('название и условие по уровню; незнакомый уровень — условие бронзы', () => {
    expect(achievementTitle('races_5')).toBe('Гонщик');
    expect(achievementTitle('routes_5')).toBe('Путешественник');
    expect(achievementTitle('rides_10')).toBe('Завсегдатай');
    expect(achievementCondition('races_5', 'silver')).toBe('Финиш в зачёте 15 разных гонок');
    expect(achievementCondition('routes_5', 'gold')).toBe(
      'Пройденные заезды по 30 разным маршрутам',
    );
    expect(achievementCondition('rides_10', 'unknown')).toBe('10 прошедших кофе-райдов');
    expect(achievementCondition('race_win', null)).toBe('Первое место в своей группе');
  });

  it('метка уровня и «Новый уровень» — только серебро и золото', () => {
    expect(levelLabel('bronze')).toBe('Бронза');
    expect(levelLabel('gold')).toBe('Золото');
    expect(isLevelUp(item({ code: 'races_5', level: 'silver' }))).toBe(true);
    expect(isLevelUp(item({ code: 'races_5', level: 'gold' }))).toBe(true);
    expect(isLevelUp(item({ code: 'races_5', level: 'bronze' }))).toBe(false);
    expect(isLevelUp(item({ code: 'races_5', level: 'unknown' }))).toBe(false);
    expect(isLevelUp(item({ code: 'races_5', level: null }))).toBe(false);
  });
});

describe('publicItems (A7, LOW-2 ревью)', () => {
  it('в публичном профиле — только гоночные коды', () => {
    const items = knownItems([
      item({ code: 'race_podium' }),
      item({ code: 'route_first' }),
      item({ code: 'ride_organizer' }),
      item({ code: 'races_5' }),
    ]);
    expect(publicItems(items).map((a) => a.code)).toEqual(['race_podium', 'races_5']);
  });
});

const SEASON_A = '0190a6f4-0000-7000-8000-000000000401';
const SEASON_B = '0190a6f4-0000-7000-8000-000000000402';
const seasonal = (
  code: 'season_regular' | 'season_podium' | 'season_champion',
  seasonId: string,
  overrides: Partial<Achievement> = {},
): Achievement =>
  item({
    code,
    object: { kind: 'season', id: seasonId, title: 'Сезон 2025' },
    factDate: '2025-10-31',
    ...overrides,
  });

describe('сезонные (achievements-seasonal, S1, S3, S7)', () => {
  it('каталог: три кода — публичные, без «Сторис результата», с карточкой (C1), флаг `seasonal`', () => {
    for (const code of ['season_regular', 'season_podium', 'season_champion'] as const) {
      expect(catalogEntry(code)).toMatchObject({
        shareable: false,
        public: true,
        storyCard: true,
        seasonal: true,
      });
    }
    expect(catalogEntry('race_win')).toMatchObject({ storyCard: true, seasonal: false });
    expect(catalogEntry('season_champion').icon).toBe('trophy');
    expect(catalogEntry('season_podium').icon).toBe('medal');
    expect(catalogEntry('season_regular').icon).toBe('calendar');
  });

  it('названия и условия; «Сезон в зачёте» — порог из контрактов', () => {
    expect(achievementTitle('season_champion')).toBe('Чемпион сезона');
    expect(achievementTitle('season_podium')).toBe('Призёр сезона');
    expect(achievementCondition('season_regular', null)).toBe(
      'Финиш с местом не меньше чем в 3 гонках одной таблицы сезона',
    );
    expect(achievementCondition('season_podium', null)).toBe(
      'Место с первого по третье в таблице сезона',
    );
  });

  it('объект — «Сезон «…»»; подпись a11y', () => {
    expect(achievementObjectText({ kind: 'season', id: SEASON_A, title: 'Сезон 2025' })).toBe(
      'Сезон «Сезон 2025»',
    );
    const [known] = knownItems([seasonal('season_champion', SEASON_A)]);
    expect(achievementA11y(known!)).toBe(
      'Достижение «Чемпион сезона»: Сезон «Сезон 2025», 31 октября 2025',
    );
  });

  it('ключи: код + сезон у сезонных, код — у прочих; flashKey — с уровнем', () => {
    expect(achievementKey(seasonal('season_podium', SEASON_A))).toBe(`season_podium:${SEASON_A}`);
    expect(achievementKey(item({ code: 'race_win' }))).toBe('race_win');
    expect(flashKey(seasonal('season_podium', SEASON_A))).toBe(`season_podium:${SEASON_A}:`);
    expect(flashKey(item({ code: 'races_5', level: 'gold' }))).toBe('races_5:gold');
  });

  it('flashQueue: два «Призёра» разных сезонов — оба в очереди; показанный сезон не скрывает другой', () => {
    const items = [
      seasonal('season_podium', SEASON_B, { seen: false }),
      seasonal('season_podium', SEASON_A, { seen: false }),
    ];
    expect(flashQueue(items).map(achievementKey)).toEqual([
      `season_podium:${SEASON_A}`,
      `season_podium:${SEASON_B}`,
    ]);
    expect(flashQueue(items, new Set([flashKey(items[1]!)])).map(achievementKey)).toEqual([
      `season_podium:${SEASON_B}`,
    ]);
  });

  it('путь экрана и адрес `seen`: сезонные — с сезоном', () => {
    expect(achievementItemPath(seasonal('season_podium', SEASON_A))).toBe(
      `/achievements/season_podium?season=${SEASON_A}`,
    );
    expect(achievementItemPath(item({ code: 'race_win' }))).toBe('/achievements/race_win');
    const [season, race] = knownItems([
      seasonal('season_podium', SEASON_A),
      item({ code: 'race_win' }),
    ]);
    expect(seenTarget(season!)).toEqual({ code: 'season_podium', seasonId: SEASON_A });
    expect(seenTarget(race!)).toEqual({ code: 'race_win', seasonId: null });
  });

  it('публичный профиль — сезонные включены', () => {
    const items = knownItems([
      seasonal('season_champion', SEASON_A),
      item({ code: 'route_first' }),
      item({ code: 'race_win' }),
    ]);
    expect(publicItems(items).map((a) => a.code)).toEqual(['season_champion', 'race_win']);
  });
});
