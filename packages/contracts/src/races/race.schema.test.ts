import { describe, expect, it } from 'vitest';

import {
  BIKE_CLASSES,
  CancelRaceRequest,
  PanelRace,
  PanelRaceQuery,
  RACE_CANCEL_REASONS,
  RACE_PHASES,
  RACE_STATUSES,
  RaceInput,
  SURFACES,
  UpdateRaceRequest,
} from './race.schema.ts';
import {
  CurrentSeasonResponse,
  RaceCard,
  RaceDetail,
  RaceListQuery,
  SeasonCard,
} from './race-public.schema.ts';
import { PanelSeason, SEASON_PHASES, SeasonInput, UpdateSeasonRequest } from './season.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const race = {
  title: 'Минское кольцо',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 42.3,
  description: null,
  windowStartsAt: '2026-10-04T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T20:59:00Z',
};

/** Коды ошибок схемы по путям. */
function codes(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('справочники — значения только в конец (R6)', () => {
  it('состав и порядок', () => {
    expect(BIKE_CLASSES).toEqual(['road', 'tt', 'gravel', 'mtb']);
    expect(SURFACES).toEqual(['asphalt', 'gravel']);
    expect(RACE_STATUSES).toEqual(['draft', 'published', 'cancelled']);
    expect(RACE_PHASES).toEqual(['draft', 'upcoming', 'open', 'closed', 'cancelled']);
    expect(RACE_CANCEL_REASONS).toEqual([
      'weather',
      'route_unavailable',
      'platform_issue',
      'season_change',
      'organizational',
    ]);
    expect(SEASON_PHASES).toEqual(['upcoming', 'current', 'finished']);
  });
});

describe('RaceInput', () => {
  it('валидная гонка; пустое описание — null; дистанция с шагом 0,1', () => {
    expect(RaceInput.parse(race)).toEqual(race);
    expect(RaceInput.parse({ ...race, description: '  ' }).description).toBeNull();
    expect(RaceInput.parse({ ...race, description: 'Строка 1\nСтрока 2' }).description).toBe(
      'Строка 1\nСтрока 2',
    );
  });

  it('лишний ключ (в т. ч. owner/status/seasonId) и объект-инъекция — ошибка', () => {
    expect(RaceInput.safeParse({ ...race, status: 'published' }).success).toBe(false);
    expect(RaceInput.safeParse({ ...race, ownerUserId: ID }).success).toBe(false);
    expect(RaceInput.safeParse({ ...race, title: { $ne: null } }).success).toBe(false);
  });

  it('границы: название, управляющие символы, дистанция, покрытия, описание', () => {
    expect(codes(RaceInput.safeParse({ ...race, title: 'ab' }))).toEqual(['title:TOO_SHORT']);
    expect(codes(RaceInput.safeParse({ ...race, title: 'x'.repeat(121) }))).toEqual([
      'title:TOO_LONG',
    ]);
    expect(codes(RaceInput.safeParse({ ...race, title: 'Гонка\u0007' }))).toEqual([
      'title:INVALID',
    ]);
    expect(codes(RaceInput.safeParse({ ...race, title: '' }))).toEqual(['title:REQUIRED']);
    for (const distanceKm of [0.9, 1000.1, 42.35]) {
      expect(RaceInput.safeParse({ ...race, distanceKm }).success).toBe(false);
    }
    expect(RaceInput.safeParse({ ...race, distanceKm: 1000 }).success).toBe(true);
    expect(RaceInput.safeParse({ ...race, surfaces: [] }).success).toBe(false);
    expect(RaceInput.safeParse({ ...race, surfaces: ['asphalt', 'asphalt'] }).success).toBe(false);
    expect(RaceInput.safeParse({ ...race, surfaces: ['asphalt', 'gravel'] }).success).toBe(true);
    expect(RaceInput.safeParse({ ...race, bikeClass: 'track' }).success).toBe(false);
    expect(RaceInput.safeParse({ ...race, description: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('моменты — только UTC с целой минутой', () => {
    expect(RaceInput.safeParse({ ...race, windowStartsAt: '2026-10-04T21:00:30Z' }).success).toBe(
      false,
    );
    expect(
      RaceInput.safeParse({ ...race, windowEndsAt: '2026-10-12T23:59:00+03:00' }).success,
    ).toBe(false);
  });
});

describe('запросы изменения', () => {
  it('UpdateRaceRequest: только version обязательна; лишние ключи — ошибка', () => {
    expect(UpdateRaceRequest.parse({ version: 3 })).toEqual({ version: 3 });
    expect(UpdateRaceRequest.parse({ version: 0, title: ' Новое ' })).toEqual({
      version: 0,
      title: 'Новое',
    });
    expect(UpdateRaceRequest.safeParse({ title: 'Новое' }).success).toBe(false);
    expect(UpdateRaceRequest.safeParse({ version: -1 }).success).toBe(false);
    expect(UpdateRaceRequest.safeParse({ version: 1, seasonId: ID }).success).toBe(false);
  });

  it('CancelRaceRequest: только шаблонная причина', () => {
    expect(CancelRaceRequest.parse({ version: 1, reason: 'weather' })).toEqual({
      version: 1,
      reason: 'weather',
    });
    expect(CancelRaceRequest.safeParse({ version: 1, reason: 'Дождь' }).success).toBe(false);
    expect(CancelRaceRequest.safeParse({ version: 1 }).success).toBe(false);
  });

  it('SeasonInput / UpdateSeasonRequest', () => {
    const season = { name: 'Сезон 2026', startsOn: '2026-04-01', endsOn: '2026-10-31' };
    expect(SeasonInput.parse(season)).toEqual(season);
    expect(SeasonInput.safeParse({ ...season, endsOn: '2026-02-30' }).success).toBe(false);
    expect(codes(SeasonInput.safeParse({ ...season, name: 'С' }))).toEqual(['name:TOO_SHORT']);
    expect(SeasonInput.safeParse({ ...season, extra: 1 }).success).toBe(false);
    expect(UpdateSeasonRequest.parse({ version: 2, name: 'Сезон' })).toEqual({
      version: 2,
      name: 'Сезон',
    });
  });
});

describe('PanelRaceQuery', () => {
  it('фильтры, mine из строки; лишние ключи и операторы — ошибка', () => {
    expect(PanelRaceQuery.parse({ status: 'draft', mine: 'true', limit: '50' })).toEqual({
      status: 'draft',
      mine: true,
      limit: 50,
    });
    expect(PanelRaceQuery.safeParse({ 'status[$ne]': 'x' }).success).toBe(false);
    expect(PanelRaceQuery.safeParse({ ownerUserId: ID }).success).toBe(false);
    expect(PanelRaceQuery.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('ответы панели', () => {
  it('PanelRace и PanelSeason разбираются строго', () => {
    const panelRace = {
      id: ID,
      status: 'draft',
      phase: 'draft',
      ...race,
      windowStartsAt: '2026-10-04T21:00:00.000Z',
      season: { id: ID, name: 'Сезон 2026', preview: true },
      owner: { userId: ID, displayName: 'Ольга' },
      cancelReason: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      publishedAt: null,
      cancelledAt: null,
      version: 0,
      editable: {
        fields: ['title'],
        canPublish: true,
        canCancel: false,
        canDiscard: true,
        reasons: [],
      },
    };
    expect(PanelRace.parse(panelRace)).toEqual(panelRace);
    expect(PanelRace.safeParse({ ...panelRace, phase: 'final' }).success).toBe(false);
    expect(
      PanelSeason.parse({
        id: ID,
        name: 'Сезон 2026',
        startsOn: '2026-04-01',
        endsOn: '2026-10-31',
        phase: 'current',
        raceCount: 3,
        version: 1,
      }).phase,
    ).toBe('current');
  });
});

describe('read-модель приложения', () => {
  const card = {
    id: ID,
    title: 'Минское кольцо',
    bikeClass: 'road',
    surfaces: ['asphalt', 'gravel'],
    distanceKm: 42.3,
    windowStartsAt: '2026-10-04T21:00:00.000Z',
    windowEndsAt: '2026-10-12T20:59:00.000Z',
    protocolPlannedAt: '2026-10-14T20:59:00.000Z',
    phase: 'open',
    cancelReason: null,
    season: { id: ID, name: 'Сезон 2026' },
  };

  it('новые значения справочников у старой сборки — unknown, а не ошибка разбора', () => {
    const parsed = RaceCard.parse({
      ...card,
      bikeClass: 'cyclocross',
      surfaces: ['asphalt', 'cobbles'],
      phase: 'final',
      cancelReason: 'flood',
    });
    expect(parsed).toMatchObject({
      bikeClass: 'unknown',
      surfaces: ['asphalt', 'unknown'],
      phase: 'unknown',
      cancelReason: 'unknown',
    });
    expect(RaceDetail.parse({ ...card, description: 'Описание' }).description).toBe('Описание');
    expect(
      CurrentSeasonResponse.parse({
        season: { id: ID, name: 'С', startsOn: '2026-04-01', endsOn: '2026-10-31', phase: 'x' },
      }).season?.phase,
    ).toBe('unknown');
    expect(CurrentSeasonResponse.parse({ season: null })).toEqual({ season: null });
    expect(SeasonCard.safeParse({ id: ID }).success).toBe(false);
  });

  it('RaceListQuery: значения по умолчанию, массивы фильтров из одной строки, границы', () => {
    expect(RaceListQuery.parse({})).toEqual({ limit: 20, scope: 'current' });
    expect(RaceListQuery.parse({ bikeClass: 'road', month: ['2026-10', '2026-11'] })).toEqual({
      limit: 20,
      scope: 'current',
      bikeClass: ['road'],
      month: ['2026-10', '2026-11'],
    });
    expect(RaceListQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(RaceListQuery.safeParse({ scope: 'all' }).success).toBe(false);
    expect(RaceListQuery.safeParse({ bikeClass: 'track' }).success).toBe(false);
    expect(
      RaceListQuery.safeParse({ bikeClass: ['road', 'tt', 'gravel', 'mtb', 'road'] }).success,
    ).toBe(false);
    expect(
      RaceListQuery.safeParse({ month: Array.from({ length: 13 }, () => '2026-10') }).success,
    ).toBe(false);
    expect(RaceListQuery.safeParse({ 'bikeClass[$ne]': 'x' }).success).toBe(false);
    // строгий enum в запросе: новое значение у старого сервера — 400, а не молчаливый фильтр
    expect(RaceListQuery.safeParse({ month: '2026-1' }).success).toBe(false);
  });
});
