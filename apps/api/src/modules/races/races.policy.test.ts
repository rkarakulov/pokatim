import { RACE_FIELDS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { RaceDoc } from './races.collection';
import {
  changedRaceFields,
  corridorDistanceKm,
  type RaceValues,
  entriesLocked,
  LOCKED_BY_ENTRIES,
  raceEditable,
  racePhase,
  raceVisible,
  seasonPhase,
  validateCorridorRoute,
  validateRaceRules,
} from './races.policy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

// окно 05.10 00:00 — 12.10 23:59 по Минску
const WINDOW_START = at('2026-10-04T21:00:00Z');
const WINDOW_END = at('2026-10-12T20:59:00Z');

const values: RaceValues = {
  title: 'Минское кольцо',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 42,
  description: null,
  windowStartsAt: WINDOW_START,
  windowEndsAt: WINDOW_END,
  protocolPlannedAt: new Date(WINDOW_END.getTime() + 48 * HOUR),
  corridor: null,
};

function race(overrides: Partial<RaceDoc> = {}): RaceDoc {
  return {
    _id: 'r',
    ownerUserId: 'u',
    status: 'published',
    ...values,
    seasonId: 's',
    cancelReason: null,
    createdAt: at('2026-09-01T00:00:00Z'),
    updatedAt: at('2026-09-01T00:00:00Z'),
    publishedAt: at('2026-09-01T00:00:00Z'),
    cancelledAt: null,
    lockedAt: null,
    version: 0,
    ...overrides,
  };
}

describe('racePhase (R5, R12)', () => {
  it('черновик и отменённая — по статусу', () => {
    expect(racePhase(race({ status: 'draft' }), WINDOW_START)).toBe('draft');
    expect(racePhase(race({ status: 'cancelled' }), WINDOW_START)).toBe('cancelled');
  });

  it('границы: начало окна, последняя минута включительно, +1 мин — закрыто', () => {
    const r = race();
    expect(racePhase(r, new Date(WINDOW_START.getTime() - 1))).toBe('upcoming');
    expect(racePhase(r, WINDOW_START)).toBe('open');
    expect(racePhase(r, WINDOW_END)).toBe('open');
    expect(racePhase(r, new Date(WINDOW_END.getTime() + MIN - 1))).toBe('open');
    expect(racePhase(r, new Date(WINDOW_END.getTime() + MIN))).toBe('closed');
  });
});

describe('seasonPhase', () => {
  const season = { startsAt: at('2026-03-31T21:00:00Z'), endsBefore: at('2026-10-31T21:00:00Z') };
  it('предстоящий, текущий, завершённый — по границам-моментам', () => {
    expect(seasonPhase(season, new Date(season.startsAt.getTime() - 1))).toBe('upcoming');
    expect(seasonPhase(season, season.startsAt)).toBe('current');
    expect(seasonPhase(season, new Date(season.endsBefore.getTime() - 1))).toBe('current');
    expect(seasonPhase(season, season.endsBefore)).toBe('finished');
  });
});

describe('validateRaceRules — форма (создание и каждое изменение)', () => {
  const now = at('2026-09-01T00:00:00Z');

  it('валидная гонка — без ошибок; 48 ч — ровно на границе минуты', () => {
    expect(validateRaceRules(values, null, now)).toEqual([]);
    expect(
      validateRaceRules(
        { ...values, protocolPlannedAt: new Date(WINDOW_END.getTime() + 48 * HOUR - MIN) },
        null,
        now,
      ),
    ).toEqual([{ path: 'protocolPlannedAt', code: 'PROTOCOL_TOO_EARLY' }]);
  });

  it('окно наоборот или нулевое — DATE_ORDER; длиннее 60 суток — INVALID', () => {
    expect(validateRaceRules({ ...values, windowEndsAt: WINDOW_START }, null, now)).toContainEqual({
      path: 'windowEndsAt',
      code: 'DATE_ORDER',
    });
    const long = new Date(WINDOW_START.getTime() + 60 * DAY + MIN);
    expect(
      validateRaceRules(
        { ...values, windowEndsAt: long, protocolPlannedAt: new Date(long.getTime() + 48 * HOUR) },
        null,
        now,
      ),
    ).toEqual([{ path: 'windowEndsAt', code: 'INVALID' }]);
  });
});

describe('validateRaceRules — правка опубликованной (V-11)', () => {
  const prev = race();

  it('до окна — все поля; новое окно не в прошлом', () => {
    const now = new Date(WINDOW_START.getTime() - DAY);
    const later = new Date(WINDOW_START.getTime() + HOUR);
    expect(
      validateRaceRules({ ...values, title: 'Новое', windowStartsAt: later }, prev, now),
    ).toEqual([]);
    expect(
      validateRaceRules({ ...values, windowStartsAt: new Date(now.getTime() - MIN) }, prev, now),
    ).toEqual([{ path: 'windowStartsAt', code: 'WINDOW_IN_PAST' }]);
  });

  it('окно открыто — начало зафиксировано; конец и протокол — можно', () => {
    const now = new Date(WINDOW_START.getTime() + DAY);
    expect(
      validateRaceRules(
        { ...values, windowStartsAt: new Date(WINDOW_START.getTime() + MIN) },
        prev,
        now,
      ),
    ).toEqual([{ path: 'windowStartsAt', code: 'FIELD_LOCKED' }]);
    const end = new Date(WINDOW_END.getTime() + DAY);
    expect(
      validateRaceRules(
        { ...values, windowEndsAt: end, protocolPlannedAt: new Date(end.getTime() + 48 * HOUR) },
        prev,
        now,
      ),
    ).toEqual([]);
  });

  it('окно закрыто — только описание и протокол позже текущего; 48 ч — всегда', () => {
    const now = new Date(WINDOW_END.getTime() + DAY);
    expect(validateRaceRules({ ...values, title: 'Новое' }, prev, now)).toEqual([
      { path: 'title', code: 'FIELD_LOCKED' },
    ]);
    expect(validateRaceRules({ ...values, description: 'Итоги скоро' }, prev, now)).toEqual([]);
    const earlier = new Date(values.protocolPlannedAt.getTime() - MIN);
    expect(validateRaceRules({ ...values, protocolPlannedAt: earlier }, prev, now)).toEqual([
      { path: 'protocolPlannedAt', code: 'PROTOCOL_ONLY_LATER' },
      { path: 'protocolPlannedAt', code: 'PROTOCOL_TOO_EARLY' },
    ]);
    const later = new Date(values.protocolPlannedAt.getTime() + DAY);
    expect(validateRaceRules({ ...values, protocolPlannedAt: later }, prev, now)).toEqual([]);
  });
});

describe('raceEditable (R10)', () => {
  it('черновик: все поля, опубликовать и удалить; окно прошло или нет сезона — причины', () => {
    const draft = race({ status: 'draft', seasonId: null });
    expect(raceEditable(draft, WINDOW_START, { canManage: true, seasonFound: true })).toEqual({
      fields: [...RACE_FIELDS],
      canPublish: true,
      canCancel: false,
      canDiscard: true,
      reasons: [],
    });
    const late = new Date(WINDOW_END.getTime() + MIN);
    expect(raceEditable(draft, late, { canManage: true, seasonFound: false })).toMatchObject({
      canPublish: false,
      reasons: ['window_closed', 'outside_season'],
    });
  });

  it('опубликованная по фазам: до окна — всё и отмена; открыто — без начала; закрыто — описание и протокол', () => {
    const r = race();
    const opts = { canManage: true, seasonFound: true };
    expect(raceEditable(r, new Date(WINDOW_START.getTime() - 1), opts)).toEqual({
      fields: [...RACE_FIELDS],
      canPublish: false,
      canCancel: true,
      canDiscard: false,
      reasons: [],
    });
    expect(raceEditable(r, WINDOW_START, opts)).toEqual({
      fields: RACE_FIELDS.filter((field) => field !== 'windowStartsAt'),
      canPublish: false,
      canCancel: true,
      canDiscard: false,
      reasons: ['window_open'],
    });
    expect(raceEditable(r, new Date(WINDOW_END.getTime() + MIN), opts)).toEqual({
      fields: ['description', 'protocolPlannedAt'],
      canPublish: false,
      canCancel: true,
      canDiscard: false,
      reasons: ['window_closed'],
    });
  });

  it('отменённая — только чтение; без права управления — ничего и без причин', () => {
    expect(
      raceEditable(race({ status: 'cancelled' }), WINDOW_START, {
        canManage: true,
        seasonFound: true,
      }),
    ).toEqual({
      fields: [],
      canPublish: false,
      canCancel: false,
      canDiscard: false,
      reasons: ['cancelled'],
    });
    expect(raceEditable(race(), WINDOW_START, { canManage: false, seasonFound: true })).toEqual({
      fields: [],
      canPublish: false,
      canCancel: false,
      canDiscard: false,
      reasons: [],
    });
  });
});

describe('changedRaceFields', () => {
  it('имена изменённых полей по значениям (даты — по моменту, массивы — по составу)', () => {
    expect(changedRaceFields(values, { ...values })).toEqual([]);
    expect(
      changedRaceFields(values, {
        ...values,
        surfaces: ['asphalt'],
        windowEndsAt: new Date(WINDOW_END.getTime()),
        description: 'x',
        distanceKm: 43,
      }),
    ).toEqual(['distanceKm', 'description']);
  });
});

describe('коридор (race-results-01 §5)', () => {
  const corridor = { routeId: 'route-a', widthM: 50, distanceM: 86_012 };
  const withCorridor: RaceValues = { ...values, corridor, distanceKm: 86 };
  const before = new Date(WINDOW_START.getTime() - 1);
  const open = WINDOW_START;
  const closed = new Date(WINDOW_END.getTime() + MIN);
  const opts = { canManage: true, seasonFound: true };

  it('дистанция с коридором — длина маршрута, 0,1 км', () => {
    expect(corridorDistanceKm(corridor)).toBe(86);
    expect(corridorDistanceKm({ ...corridor, distanceM: 62_049 })).toBe(62);
    expect(corridorDistanceKm({ ...corridor, distanceM: 62_050 })).toBe(62.1);
    expect(corridorDistanceKm({ ...corridor, distanceM: 1_000 })).toBe(1);
  });

  it('sameValue: коридор сравнивается по маршруту и допуску (снимок длины не важен)', () => {
    expect(changedRaceFields(withCorridor, { ...withCorridor })).toEqual([]);
    expect(
      changedRaceFields(withCorridor, {
        ...withCorridor,
        corridor: { ...corridor, distanceM: 1 },
      }),
    ).toEqual([]);
    expect(
      changedRaceFields(withCorridor, { ...withCorridor, corridor: { ...corridor, widthM: 100 } }),
    ).toEqual(['corridor']);
    expect(changedRaceFields(values, withCorridor)).toEqual(['distanceKm', 'corridor']);
    expect(changedRaceFields(withCorridor, { ...withCorridor, corridor: null })).toEqual([
      'corridor',
    ]);
  });

  it('distanceKm при коридоре ≠ вычисленной — FIELD_LOCKED; совпадает — без ошибок', () => {
    expect(validateRaceRules(withCorridor, null, before)).toEqual([]);
    expect(validateRaceRules({ ...withCorridor, distanceKm: 85.9 }, null, before)).toEqual([
      { path: 'distanceKm', code: 'FIELD_LOCKED' },
    ]);
  });

  it('черновик и до окна — коридор задать, сменить, снять', () => {
    for (const prev of [race({ status: 'draft', seasonId: null }), race()]) {
      expect(validateRaceRules(withCorridor, prev, before)).toEqual([]);
      const prevWith = { ...prev, ...withCorridor };
      expect(
        validateRaceRules(
          {
            ...withCorridor,
            corridor: { ...corridor, routeId: 'route-b', distanceM: 70_000 },
            distanceKm: 70,
          },
          prevWith,
          before,
        ),
      ).toEqual([]);
      expect(validateRaceRules({ ...withCorridor, corridor: null }, prevWith, before)).toEqual([]);
    }
  });

  it('окно открыто: без коридора — задать можно; с коридором — FIELD_LOCKED (смена, допуск, снятие)', () => {
    expect(validateRaceRules(withCorridor, race(), open)).toEqual([]);
    const prevWith = race({ ...withCorridor });
    for (const next of [
      { ...withCorridor, corridor: { ...corridor, widthM: 100 } },
      { ...withCorridor, corridor: null },
    ]) {
      expect(validateRaceRules(next, prevWith, open)).toEqual([
        { path: 'corridor', code: 'FIELD_LOCKED' },
      ]);
    }
  });

  it('окно закрыто — коридор FIELD_LOCKED', () => {
    expect(validateRaceRules(withCorridor, race(), closed)).toEqual(
      expect.arrayContaining([{ path: 'corridor', code: 'FIELD_LOCKED' }]),
    );
  });

  it('V-12: есть заявки — коридор, окно, класс, покрытия FIELD_LOCKED в любой фазе; причина entries_locked', () => {
    const lockedAt = at('2026-09-20T00:00:00Z');
    expect(LOCKED_BY_ENTRIES).toEqual([
      'corridor',
      'windowStartsAt',
      'windowEndsAt',
      'bikeClass',
      'surfaces',
    ]);
    for (const now of [before, open]) {
      const prev = race({ ...withCorridor, lockedAt });
      const editable = raceEditable(prev, now, opts);
      for (const field of LOCKED_BY_ENTRIES) expect(editable.fields).not.toContain(field);
      expect(editable.fields).toEqual(expect.arrayContaining(['title', 'description']));
      expect(editable.reasons.at(-1)).toBe('entries_locked');
      const longer = new Date(WINDOW_END.getTime() + DAY);
      expect(
        validateRaceRules(
          {
            ...withCorridor,
            corridor: { ...corridor, widthM: 100 },
            windowEndsAt: longer,
            protocolPlannedAt: new Date(longer.getTime() + 48 * HOUR),
            bikeClass: 'gravel',
            surfaces: ['gravel'],
          },
          prev,
          now,
        ).filter((issue) => issue.code === 'FIELD_LOCKED'),
      ).toEqual(
        expect.arrayContaining([
          { path: 'bikeClass', code: 'FIELD_LOCKED' },
          { path: 'surfaces', code: 'FIELD_LOCKED' },
          { path: 'windowEndsAt', code: 'FIELD_LOCKED' },
          { path: 'corridor', code: 'FIELD_LOCKED' },
        ]),
      );
      // название и описание — как V-11
      expect(
        validateRaceRules({ ...withCorridor, title: 'Новое', description: 'Текст' }, prev, now),
      ).toEqual([]);
    }
    expect(raceEditable(race({ ...withCorridor }), before, opts).reasons).toEqual([]);
    expect(entriesLocked(race())).toBe(false);
    const legacy = race();
    delete (legacy as Partial<RaceDoc>).lockedAt;
    expect(entriesLocked(legacy)).toBe(false);
  });

  it('ворота: линейный маршрут с концами ≤ 2·max(widthM, 30) — CORRIDOR_GATES_OVERLAP; петля — нет', () => {
    const issue = { path: 'corridor.routeId', code: 'CORRIDOR_GATES_OVERLAP' };
    expect(validateCorridorRoute({ isLoop: false, endsDistanceM: 100 }, 50)).toEqual(issue);
    expect(validateCorridorRoute({ isLoop: false, endsDistanceM: 100.5 }, 50)).toBeNull();
    expect(validateCorridorRoute({ isLoop: false, endsDistanceM: 60 }, 20)).toEqual(issue);
    expect(validateCorridorRoute({ isLoop: false, endsDistanceM: 61 }, 20)).toBeNull();
    expect(validateCorridorRoute({ isLoop: true, endsDistanceM: 0 }, 200)).toBeNull();
  });

  it('editable: с коридором distanceKm вне fields; открытое окно — corridor только без коридора', () => {
    const draftWith = race({ status: 'draft', seasonId: null, ...withCorridor });
    expect(raceEditable(draftWith, before, opts).fields).toEqual(
      RACE_FIELDS.filter((field) => field !== 'distanceKm'),
    );
    expect(raceEditable(race(), open, opts).fields).toContain('corridor');
    expect(raceEditable(race(), open, opts).fields).toContain('distanceKm');
    const openWith = raceEditable(race({ ...withCorridor }), open, opts).fields;
    expect(openWith).not.toContain('corridor');
    expect(openWith).not.toContain('distanceKm');
    expect(raceEditable(race({ ...withCorridor }), closed, opts).fields).toEqual([
      'description',
      'protocolPlannedAt',
    ]);
  });

  it('видимость в панели: организатор — только свои; manage_any и только чтение — все', () => {
    const own = race({ ownerUserId: 'org' });
    const other = race({ ownerUserId: 'x' });
    const organizer = { userId: 'org', permissions: ['races.read', 'races.manage'] } as const;
    const admin = { userId: 'a', permissions: ['races.manage', 'races.manage_any'] } as const;
    const moderator = { userId: 'm', permissions: ['races.read'] } as const;
    expect(raceVisible(organizer, own)).toBe(true);
    expect(raceVisible(organizer, other)).toBe(false);
    expect(raceVisible(admin, other)).toBe(true);
    expect(raceVisible(moderator, other)).toBe(true);
  });

  it('документ до миграции без поля corridor — как без коридора', () => {
    const legacy = race();
    delete (legacy as Partial<RaceDoc>).corridor;
    expect(raceEditable(legacy, open, opts).fields).toContain('corridor');
    expect(validateRaceRules({ ...values }, legacy, open)).toEqual([]);
  });
});
