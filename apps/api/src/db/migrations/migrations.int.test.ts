import { MIGRATIONS_COLLECTION, runMongoMigrations } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';
import { PANEL_COLLECTIONS } from '../../modules/panel/panel.collection';
import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { CALENDAR_COLLECTIONS } from '../../modules/calendar/calendar.collection';
import { IDENTITY_INDEXES } from './0002_identity';
import { IDENTITY_TTL_SECONDS } from './0003_identity_ttl';
import { profile } from './0004_profile';
import { panel, PANEL_SESSION_TTL_SECONDS } from './0005_panel';
import { panelAuditSubject } from './0006_panel_audit_subject';
import { races } from './0007_races';
import { calendar } from './0008_calendar';
import { racesSeasonPublicIdx } from './0009_races_season_public_idx';
import { tracks } from './0010_tracks';
import { devices } from './0011_devices';
import { trackSourceRefs } from './0012_track_source_refs';
import { routes } from './0013_routes';
import { rides } from './0014_rides';
import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { results } from './0015_results';
import { protocol } from './0016_protocol';
import { rideReports } from './0017_ride_reports';
import { disputes } from './0018_disputes';
import { profileConsents } from './0019_profile_consents';
import { routesCatalog } from './0020_routes_catalog';
import { routesRider } from './0021_routes_rider';
import { routesDerived } from './0022_routes_derived';
import { DISPUTES_COLLECTIONS } from '../../modules/disputes/disputes.collection';
import { RIDE_REPORTS_COLLECTIONS } from '../../modules/rides/ride-reports.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';
import { TRACKS_COLLECTIONS } from '../../modules/tracks/tracks.collection';
import { DEVICES_COLLECTIONS } from '../../modules/devices/devices.collection';
import { migrations } from './index';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

/** Индексы коллекции без служебного `_id_`: имя → ключ и опции, которые проверяет AC5. */
async function indexesOf(collection: string) {
  const all = await h.db.collection(collection).indexes();
  return Object.fromEntries(
    all
      .filter((index) => index.name !== '_id_')
      .map((index) => [
        index.name,
        {
          key: index.key,
          unique: index.unique ?? false,
          partialFilterExpression: index.partialFilterExpression,
          expireAfterSeconds: index.expireAfterSeconds,
        },
      ]),
  );
}

describe('миграции MongoDB на чистой *_test (AC5)', () => {
  it('применены по порядку: 0001_outbox … последняя', async () => {
    const applied = await h.db
      .collection<{ _id: string }>(MIGRATIONS_COLLECTION)
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(applied.map((doc) => doc._id)).toEqual([
      '0001_outbox',
      '0002_identity',
      '0003_identity_ttl',
      '0004_profile',
      '0005_panel',
      '0006_panel_audit_subject',
      '0007_races',
      '0008_calendar',
      '0009_races_season_public_idx',
      '0010_tracks',
      '0011_devices',
      '0012_track_source_refs',
      '0013_routes',
      '0014_rides',
      '0015_results',
      '0016_protocol',
      '0017_ride_reports',
      '0018_disputes',
      '0019_profile_consents',
      '0020_routes_catalog',
      '0021_routes_rider',
      '0022_routes_derived',
    ]);
  });

  it('0005_panel: коллекции, индексы, TTL сессий и документ panel_meta.admins; повторный up не сбрасывает версию (AC13)', async () => {
    const plain = (key: Record<string, number>, unique = false, ttl?: number) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: ttl,
    });
    expect(await indexesOf(PANEL_COLLECTIONS.members)).toEqual({
      panel_members_role_status_idx: plain({ role: 1, status: 1 }),
    });
    expect(await indexesOf(PANEL_COLLECTIONS.sessions)).toEqual({
      panel_sessions_token_hash_unique: plain({ tokenHash: 1 }, true),
      panel_sessions_user_id_idx: plain({ userId: 1 }),
      panel_sessions_expires_at_ttl: plain({ expiresAt: 1 }, false, PANEL_SESSION_TTL_SECONDS),
    });
    expect(await indexesOf(PANEL_COLLECTIONS.audit)).toEqual({
      panel_audit_action_idx: plain({ action: 1, _id: -1 }),
      panel_audit_actor_idx: plain({ 'actor.userId': 1, _id: -1 }),
      panel_audit_target_idx: plain({ targetUserId: 1, _id: -1 }),
      // 0006_panel_audit_subject (admin-02)
      panel_audit_subject_idx: plain({ 'subject.id': 1, _id: -1 }),
    });
    await panelAuditSubject.up(h.db);
    await panelAuditSubject.up(h.db);
    // документ-замок: создаётся up; повторный up не сбрасывает версию (другие файлы тестов чистят коллекции)
    const meta = h.db.collection<{ _id: string; version: number }>(PANEL_COLLECTIONS.meta);
    await meta.deleteMany({});
    await panel.up(h.db);
    expect(await meta.find().toArray()).toEqual([{ _id: 'admins', version: 0 }]);

    await meta.updateOne({ _id: 'admins' }, { $inc: { version: 1 } });
    await panel.up(h.db);
    await panel.up(h.db);
    expect(await meta.find().toArray()).toEqual([{ _id: 'admins', version: 1 }]);
  });

  it('0007_races: коллекции, индексы, документ race_meta.schedule; повторный up не сбрасывает версию (AC14)', async () => {
    const plain = (key: Record<string, number>) => ({
      key,
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    expect(await indexesOf(RACES_COLLECTIONS.seasons)).toEqual({
      seasons_starts_at_idx: plain({ startsAt: 1 }),
    });
    expect(await indexesOf(RACES_COLLECTIONS.races)).toEqual({
      races_public_current_idx: plain({ status: 1, windowStartsAt: 1, _id: 1 }),
      races_public_past_idx: plain({ status: 1, windowEndsAt: -1, _id: -1 }),
      races_season_idx: plain({ seasonId: 1, windowEndsAt: 1 }),
      races_owner_idx: plain({ ownerUserId: 1, windowStartsAt: -1, _id: -1 }),
      races_panel_idx: plain({ windowStartsAt: -1, _id: -1 }),
      // 0009_races_season_public_idx (app-03): старый races_season_idx остаётся
      races_season_public_idx: plain({ seasonId: 1, windowEndsAt: 1, _id: 1 }),
      // 0020_routes_catalog (routes-01): гонки маршрута каталога
      races_route_idx: plain({ 'corridor.routeId': 1, windowStartsAt: -1, _id: -1 }),
    });
    const meta = h.db.collection<{ _id: string; version: number }>(RACES_COLLECTIONS.meta);
    await meta.deleteMany({});
    await races.up(h.db);
    expect(await meta.find().toArray()).toEqual([{ _id: 'schedule', version: 0 }]);
    await meta.updateOne({ _id: 'schedule' }, { $inc: { version: 1 } });
    await races.up(h.db);
    await races.up(h.db);
    expect(await meta.find().toArray()).toEqual([{ _id: 'schedule', version: 1 }]);
  });

  it('0009_races_season_public_idx: повторный up — без ошибки, индексы те же (R3)', async () => {
    const before = await indexesOf(RACES_COLLECTIONS.races);
    expect(before).toHaveProperty('races_season_public_idx');
    await racesSeasonPublicIdx.up(h.db);
    await racesSeasonPublicIdx.up(h.db);
    expect(await indexesOf(RACES_COLLECTIONS.races)).toEqual(before);
  });

  it('0014_rides: коллекция и индексы (multikey участника); после 0013_routes; повторный up — без ошибки (AC-T6)', async () => {
    const plain = (key: Record<string, number>) => ({
      key,
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const expected = {
      rides_feed_idx: plain({ startsAt: 1, _id: 1 }),
      rides_city_feed_idx: plain({ cityCode: 1, startsAt: 1, _id: 1 }),
      rides_participant_idx: plain({ 'participants.userId': 1, startsAt: 1 }),
      rides_organizer_idx: plain({ organizerUserId: 1, startsAt: -1 }),
    };
    // индексы очередей модерации на `rides` добавляет 0017_ride_reports — здесь только свои
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toMatchObject(expected);
    const ids = migrations.map((migration) => migration.id);
    expect(ids.slice(ids.indexOf('0013_routes'), ids.indexOf('0013_routes') + 2)).toEqual([
      '0013_routes',
      '0014_rides',
    ]);
    await rides.up(h.db);
    await rides.up(h.db);
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toMatchObject(expected);
  });

  it('0008_calendar: коллекция и индексы; повторный up — без ошибки (AC14)', async () => {
    const plain = (key: Record<string, number>) => ({
      key,
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const expected = {
      calendar_starts_public_idx: plain({ status: 1, startsOn: 1, _id: 1 }),
      calendar_starts_city_idx: plain({ status: 1, cityKey: 1, startsOn: 1 }),
      calendar_starts_panel_idx: plain({ startsOn: -1, _id: -1 }),
    };
    expect(await indexesOf(CALENDAR_COLLECTIONS.starts)).toEqual(expected);
    await calendar.up(h.db);
    await calendar.up(h.db);
    expect(await indexesOf(CALENDAR_COLLECTIONS.starts)).toEqual(expected);
  });

  it('0010_tracks: коллекции и индексы (уникальные, частичный, 2dsphere); повторный up — без ошибки (AC14)', async () => {
    const index = (key: Record<string, unknown>, unique = false, partial?: object) => ({
      key,
      unique,
      partialFilterExpression: partial,
      expireAfterSeconds: undefined,
    });
    const expected = {
      [TRACKS_COLLECTIONS.uploads]: {
        track_uploads_user_sha_unique: index({ userId: 1, sha256: 1 }, true),
        track_uploads_source_ref_unique: index({ source: 1, sourceRef: 1 }, true, {
          sourceRef: { $type: 'string' },
        }),
        track_uploads_user_created_idx: index({ userId: 1, _id: -1 }),
        track_uploads_cleanup_idx: index({ status: 1, updatedAt: 1 }),
      },
      [TRACKS_COLLECTIONS.activities]: {
        activities_user_started_idx: index({ userId: 1, startedAt: -1 }),
        activities_upload_idx: index({ uploadId: 1 }),
        activities_start_point_2dsphere: index({ startPoint: '2dsphere' }),
      },
      [TRACKS_COLLECTIONS.tracks]: {
        activity_tracks_line_2dsphere: index({ line: '2dsphere' }),
        activity_tracks_user_idx: index({ userId: 1 }),
      },
      [TRACKS_COLLECTIONS.meta]: {},
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
    await tracks.up(h.db);
    await tracks.up(h.db);
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0010_tracks: 2dsphere принимает линию трека и отвергает вырожденную (одна точка дважды)', async () => {
    const lines = h.db.collection<{ _id: string; userId: string; line: object }>(
      TRACKS_COLLECTIONS.tracks,
    );
    await lines.deleteMany({});
    await lines.insertOne({
      _id: 'ok',
      userId: 'u',
      line: {
        type: 'LineString',
        coordinates: [
          [27.5615, 53.9023],
          [27.57, 53.91],
          [27.58, 53.905],
        ],
      },
    });
    await expect(
      lines.insertOne({
        _id: 'bad',
        userId: 'u',
        line: {
          type: 'LineString',
          coordinates: [
            [27.5615, 53.9023],
            [27.5615, 53.9023],
          ],
        },
      }),
    ).rejects.toThrow();
    await lines.deleteMany({});
  });

  it('0011_devices: коллекции и индексы (уникальные, частичные, TTL тикетов); повторный up — без ошибки (AC14)', async () => {
    const index = (
      key: Record<string, unknown>,
      unique = false,
      partial?: object,
      ttl?: number,
    ) => ({ key, unique, partialFilterExpression: partial, expireAfterSeconds: ttl });
    const expected = {
      [DEVICES_COLLECTIONS.accounts]: {
        device_accounts_agg_user_unique: index({ aggregator: 1, aggUserId: 1 }, true),
      },
      [DEVICES_COLLECTIONS.connections]: {
        device_connections_user_provider_live_unique: index({ userId: 1, provider: 1 }, true, {
          status: { $in: ['pending', 'active', 'disconnecting'] },
        }),
        device_connections_agg_user_idx: index({ aggUserId: 1 }),
        device_connections_status_idx: index({ status: 1, pendingUntil: 1 }),
      },
      [DEVICES_COLLECTIONS.tickets]: {
        device_link_tickets_ttl: index({ expiresAt: 1 }, false, undefined, 0),
      },
      [DEVICES_COLLECTIONS.imports]: {
        device_imports_workout_unique: index({ provider: 1, aggWorkoutId: 1 }, true),
        device_imports_upload_idx: index({ uploadId: 1 }, false, { uploadId: { $type: 'string' } }),
      },
      [DEVICES_COLLECTIONS.audit]: {
        device_audit_user_idx: index({ userId: 1, _id: -1 }),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
    await devices.up(h.db);
    await devices.up(h.db);
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0012_track_source_refs: коллекция маркеров источника и индекс по пользователю; повторный up — без ошибки', async () => {
    const expected = {
      track_source_refs_user_idx: {
        key: { userId: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(TRACKS_COLLECTIONS.sourceRefs)).toEqual(expected);
    await trackSourceRefs.up(h.db);
    await trackSourceRefs.up(h.db);
    expect(await indexesOf(TRACKS_COLLECTIONS.sourceRefs)).toEqual(expected);
  });

  it('0013_routes: коллекции и индексы маршрутов, бэкфилл races.corridor = null; повторный up — без изменений (AC11)', async () => {
    const index = (key: Record<string, unknown>, unique = false) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const expected = {
      [ROUTES_COLLECTIONS.routes]: {
        // routes_owner_sha_unique удалён 0021_routes_rider (routes-02, HG-1)
        routes_list_idx: index({ origin: 1, status: 1, _id: -1 }),
        routes_owner_idx: index({ ownerUserId: 1, _id: -1 }),
        // 0020_routes_catalog (routes-01): частичный индекс каталога
        routes_catalog_idx: {
          ...index({ 'catalog.publishedAt': -1, _id: -1 }),
          partialFilterExpression: { 'catalog.publishedAt': { $type: 'date' } },
        },
        // 0021_routes_rider (routes-02): дедуп в пределах происхождения, список своих маршрутов
        routes_owner_origin_sha_unique: index({ ownerUserId: 1, origin: 1, sha256: 1 }, true),
        routes_owner_origin_idx: index({ ownerUserId: 1, origin: 1, _id: -1 }),
      },
      // 0022_routes_derived (routes-03): выборка бэкфилла производных
      [ROUTES_COLLECTIONS.geometries]: {
        route_geometries_derived_idx: index({ derivedVersion: 1 }),
      },
      [ROUTES_COLLECTIONS.sources]: {},
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }

    // гонка до слайса коридора (без поля) и гонка с коридором — бэкфилл трогает только первую
    const races = h.db.collection<{ _id: string; corridor?: unknown }>(RACES_COLLECTIONS.races);
    const corridor = { routeId: 'r', widthM: 50, distanceM: 42_000 };
    await races.insertMany([{ _id: 'old-race' }, { _id: 'corridor-race', corridor }]);
    await routes.up(h.db);
    await routes.up(h.db);
    // повтор 0013 заново создаёт старый индекс дедупа — следующая 0021 его снова удаляет
    await routesRider.up(h.db);
    expect(await races.findOne({ _id: 'old-race' })).toEqual({ _id: 'old-race', corridor: null });
    expect(await races.findOne({ _id: 'corridor-race' })).toEqual({
      _id: 'corridor-race',
      corridor,
    });
    await races.deleteMany({ _id: { $in: ['old-race', 'corridor-race'] } });

    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0015_results: коллекции и индексы заявок и попыток, бэкфилл races.lockedAt = null; повторный up — без изменений (AC24)', async () => {
    const index = (
      key: Record<string, unknown>,
      unique = false,
      partialFilterExpression: Record<string, unknown> | undefined = undefined,
    ) => ({ key, unique, partialFilterExpression, expireAfterSeconds: undefined });
    const expected = {
      [RESULTS_COLLECTIONS.entries]: {
        race_entries_race_user_unique: index({ raceId: 1, userId: 1 }, true),
        race_entries_user_idx: index({ userId: 1, status: 1 }),
        race_entries_ranking_idx: index(
          { raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
          false,
          { status: 'active', best: { $type: 'object' } },
        ),
        race_entries_race_idx: index({ raceId: 1, status: 1 }),
      },
      [RESULTS_COLLECTIONS.attempts]: {
        race_attempts_race_activity_unique: index({ raceId: 1, activityId: 1 }, true),
        race_attempts_entry_idx: index({ entryId: 1, _id: -1 }),
        race_attempts_activity_idx: index({ activityId: 1 }),
        race_attempts_race_status_idx: index({ raceId: 1, status: 1, _id: -1 }),
        race_attempts_stuck_idx: index({ status: 1, updatedAt: 1 }, false, {
          status: { $in: ['queued', 'checking'] },
        }),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }

    // гонка до слайса заявок (без поля) и гонка с заявками — бэкфилл трогает только первую
    const races = h.db.collection<{ _id: string; lockedAt?: unknown }>(RACES_COLLECTIONS.races);
    const lockedAt = new Date('2026-10-24T10:00:00Z');
    await races.insertMany([{ _id: 'old-race' }, { _id: 'locked-race', lockedAt }]);
    await results.up(h.db);
    await results.up(h.db);
    expect(await races.findOne({ _id: 'old-race' })).toEqual({ _id: 'old-race', lockedAt: null });
    expect(await races.findOne({ _id: 'locked-race' })).toEqual({ _id: 'locked-race', lockedAt });
    await races.deleteMany({ _id: { $in: ['old-race', 'locked-race'] } });

    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0016_protocol: коллекции протокола и индексы, бэкфилл races.protocolPublishedAt = null; повторный up — без изменений (AC13)', async () => {
    const index = (
      key: Record<string, unknown>,
      unique = false,
      partialFilterExpression: Record<string, unknown> | undefined = undefined,
    ) => ({ key, unique, partialFilterExpression, expireAfterSeconds: undefined });
    const expected = {
      [RESULTS_COLLECTIONS.reviews]: {
        race_attempt_reviews_race_idx: index({ raceId: 1, _id: 1 }),
        race_attempt_reviews_attempt_idx: index({ attemptId: 1, _id: 1 }),
      },
      [RESULTS_COLLECTIONS.protocolRows]: {
        race_protocol_rows_unique: index({ raceId: 1, revision: 1, entryId: 1 }, true),
        race_protocol_rows_order_unique: index({ raceId: 1, revision: 1, order: 1 }, true),
      },
      [RESULTS_COLLECTIONS.recalculations]: {
        race_recalculations_race_idx: index({ raceId: 1, _id: 1 }),
        race_recalculations_revision_unique: index({ raceId: 1, revision: 1 }, true, {
          revision: { $type: 'number' },
        }),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }

    const races = h.db.collection<{ _id: string; protocolPublishedAt?: unknown }>(
      RACES_COLLECTIONS.races,
    );
    const publishedAt = new Date('2026-10-28T10:00:00Z');
    await races.insertMany([
      { _id: 'old-race' },
      { _id: 'final-race', protocolPublishedAt: publishedAt },
    ]);
    await protocol.up(h.db);
    await protocol.up(h.db);
    expect(await races.findOne({ _id: 'old-race' })).toEqual({
      _id: 'old-race',
      protocolPublishedAt: null,
    });
    expect(await races.findOne({ _id: 'final-race' })).toEqual({
      _id: 'final-race',
      protocolPublishedAt: publishedAt,
    });
    await races.deleteMany({ _id: { $in: ['old-race', 'final-race'] } });
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0017_ride_reports: жалобы (unique), очереди модерации (partial), бэкфилл полей модерации; после 0016_protocol; повторный up — без изменений', async () => {
    const index = (
      key: Record<string, unknown>,
      unique = false,
      partialFilterExpression: Record<string, unknown> | undefined = undefined,
    ) => ({ key, unique, partialFilterExpression, expireAfterSeconds: undefined });
    const reports = {
      ride_reports_ride_reporter_unique: index({ rideId: 1, reporterUserId: 1 }, true),
      ride_reports_ride_idx: index({ rideId: 1, _id: -1 }),
    };
    const queues = {
      rides_report_queue_idx: index({ lastReportAt: -1, _id: -1 }, false, {
        openReportCount: { $gt: 0 },
      }),
      rides_hidden_queue_idx: index({ hiddenAt: -1, _id: -1 }, false, { status: 'hidden' }),
    };
    expect(await indexesOf(RIDE_REPORTS_COLLECTIONS.reports)).toEqual(reports);
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toMatchObject(queues);
    const ids = migrations.map((migration) => migration.id);
    expect(ids.slice(ids.indexOf('0016_protocol'), ids.indexOf('0016_protocol') + 2)).toEqual([
      '0016_protocol',
      '0017_ride_reports',
    ]);

    // райд до 05b (без полей) и скрытый — бэкфилл трогает только отсутствующие поля
    const ridesDb = h.db.collection<Record<string, unknown> & { _id: string }>(
      RIDES_COLLECTIONS.rides,
    );
    const hiddenAt = new Date('2026-10-27T10:00:00Z');
    const hidden = {
      _id: 'hidden-ride',
      status: 'hidden',
      openReportCount: 0,
      lastReportAt: hiddenAt,
      hiddenAt,
      hiddenFromStatus: 'cancelled',
    };
    await ridesDb.insertMany([{ _id: 'old-ride', status: 'published' }, hidden]);
    await rideReports.up(h.db);
    await rideReports.up(h.db);
    expect(await ridesDb.findOne({ _id: 'old-ride' })).toEqual({
      _id: 'old-ride',
      status: 'published',
      openReportCount: 0,
      lastReportAt: null,
      hiddenAt: null,
      hiddenFromStatus: null,
    });
    expect(await ridesDb.findOne({ _id: 'hidden-ride' })).toEqual(hidden);
    await ridesDb.deleteMany({ _id: { $in: ['old-ride', 'hidden-ride'] } });

    expect(await indexesOf(RIDE_REPORTS_COLLECTIONS.reports)).toEqual(reports);
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toMatchObject(queues);
  });

  it('0018_disputes: споры (unique пары), гейты и списки, история; бэкфилл disqualified и disputeFilingClosedAt; повторный up — без изменений', async () => {
    const index = (key: Record<string, unknown>, unique = false) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const disputeIndexes = {
      disputes_pair_unique: index({ raceId: 1, complainantUserId: 1, targetEntryId: 1 }, true),
      disputes_target_idx: index({ targetEntryId: 1, status: 1 }),
      disputes_race_idx: index({ raceId: 1, status: 1, filedAt: -1, _id: -1 }),
      disputes_queue_idx: index({ status: 1, filedAt: -1, _id: -1 }),
      disputes_all_idx: index({ filedAt: -1, _id: -1 }),
    };
    const eventIndexes = {
      dispute_events_dispute_idx: index({ disputeId: 1, at: 1, _id: 1 }),
    };
    expect(await indexesOf(DISPUTES_COLLECTIONS.disputes)).toEqual(disputeIndexes);
    expect(await indexesOf(DISPUTES_COLLECTIONS.events)).toEqual(eventIndexes);

    // заявка и гонка до 06 (без полей) и уже с полями — бэкфилл трогает только отсутствующие
    const entriesDb = h.db.collection<Record<string, unknown> & { _id: string }>(
      RESULTS_COLLECTIONS.entries,
    );
    const racesDb = h.db.collection<Record<string, unknown> & { _id: string }>(
      RACES_COLLECTIONS.races,
    );
    const mark = { at: new Date('2026-10-27T10:00:00Z'), disputeId: 'd' };
    await entriesDb.insertMany([
      { _id: 'old-entry', raceId: 'r', userId: 'u1', status: 'active' },
      { _id: 'dq-entry', raceId: 'r', userId: 'u2', status: 'active', disqualified: mark },
    ]);
    await racesDb.insertMany([
      { _id: 'old-race', status: 'published' },
      { _id: 'frozen-race', status: 'published', disputeFilingClosedAt: mark.at },
    ]);
    await disputes.up(h.db);
    await disputes.up(h.db);
    expect(await entriesDb.findOne({ _id: 'old-entry' })).toEqual({
      _id: 'old-entry',
      raceId: 'r',
      userId: 'u1',
      status: 'active',
      disqualified: null,
    });
    expect((await entriesDb.findOne({ _id: 'dq-entry' }))?.disqualified).toEqual(mark);
    expect(await racesDb.findOne({ _id: 'old-race' })).toEqual({
      _id: 'old-race',
      status: 'published',
      disputeFilingClosedAt: null,
    });
    expect((await racesDb.findOne({ _id: 'frozen-race' }))?.disputeFilingClosedAt).toEqual(mark.at);
    await entriesDb.deleteMany({ _id: { $in: ['old-entry', 'dq-entry'] } });
    await racesDb.deleteMany({ _id: { $in: ['old-race', 'frozen-race'] } });

    expect(await indexesOf(DISPUTES_COLLECTIONS.disputes)).toEqual(disputeIndexes);
    expect(await indexesOf(DISPUTES_COLLECTIONS.events)).toEqual(eventIndexes);
  });

  it('0019_profile_consents: журнал согласий с индексом (userId, at); повторный up — без изменений (AC3)', async () => {
    const exists = () =>
      h.db
        .listCollections({ name: PROFILE_COLLECTIONS.consentEvents }, { nameOnly: true })
        .toArray();
    const expected = {
      profile_consent_events_user_idx: {
        key: { userId: 1, at: -1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.consentEvents)).toEqual(expected);

    await h.db.collection(PROFILE_COLLECTIONS.consentEvents).drop();
    await profileConsents.up(h.db);
    await profileConsents.up(h.db);
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.consentEvents)).toEqual(expected);
  });

  it('0020_routes_catalog: частичный индекс каталога, индекс гонок маршрута, бэкфилл routes.catalog = null; повторный up — без изменений', async () => {
    expect(migrations.map((migration) => migration.id)).toContain('0020_routes_catalog');
    const routeIndexes = await indexesOf(ROUTES_COLLECTIONS.routes);
    expect(routeIndexes.routes_catalog_idx).toEqual({
      key: { 'catalog.publishedAt': -1, _id: -1 },
      unique: false,
      partialFilterExpression: { 'catalog.publishedAt': { $type: 'date' } },
      expireAfterSeconds: undefined,
    });
    const raceIndexes = await indexesOf(RACES_COLLECTIONS.races);
    expect(raceIndexes.races_route_idx).toEqual({
      key: { 'corridor.routeId': 1, windowStartsAt: -1, _id: -1 },
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });

    // маршрут до слайса каталога (без поля) и опубликованный — бэкфилл трогает только первый
    // (уникальный индекс `(ownerUserId, sha256)` — у каждого свой sha256)
    const docs = h.db.collection<{ _id: string; sha256: string; catalog?: unknown }>(
      ROUTES_COLLECTIONS.routes,
    );
    const catalog = {
      city: 'minsk',
      surfaces: ['asphalt'],
      publishedAt: new Date('2026-10-27T10:00:00Z'),
    };
    await docs.insertMany([
      { _id: 'old-route', sha256: 'a' },
      { _id: 'catalog-route', sha256: 'b', catalog },
    ]);
    await routesCatalog.up(h.db);
    await routesCatalog.up(h.db);
    expect(await docs.findOne({ _id: 'old-route' })).toEqual({
      _id: 'old-route',
      sha256: 'a',
      catalog: null,
    });
    expect(await docs.findOne({ _id: 'catalog-route' })).toEqual({
      _id: 'catalog-route',
      sha256: 'b',
      catalog,
    });
    await docs.deleteMany({ _id: { $in: ['old-route', 'catalog-route'] } });

    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toEqual(routeIndexes);
    expect(await indexesOf(RACES_COLLECTIONS.races)).toEqual(raceIndexes);
  });

  it('0021_routes_rider: дедуп (ownerUserId, origin, sha256) и список своих — созданы, routes_owner_sha_unique удалён; повторный up — без ошибки', async () => {
    expect(migrations.map((migration) => migration.id)).toContain('0021_routes_rider');
    const index = (key: Record<string, unknown>, unique = false) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const before = await indexesOf(ROUTES_COLLECTIONS.routes);
    expect(before.routes_owner_origin_sha_unique).toEqual(
      index({ ownerUserId: 1, origin: 1, sha256: 1 }, true),
    );
    expect(before.routes_owner_origin_idx).toEqual(index({ ownerUserId: 1, origin: 1, _id: -1 }));
    expect(before.routes_owner_sha_unique).toBeUndefined();

    // тот же файл того же пользователя: маршрут платформы и маршрут райдера уживаются; дубль в пределах origin — нет
    const docs = h.db.collection<{
      _id: string;
      ownerUserId: string;
      origin: string;
      sha256: string;
    }>(ROUTES_COLLECTIONS.routes);
    await docs.insertMany([
      { _id: 'platform-copy', ownerUserId: 'u', origin: 'platform', sha256: 'same' },
      { _id: 'rider-copy', ownerUserId: 'u', origin: 'rider', sha256: 'same' },
    ]);
    await expect(
      docs.insertOne({ _id: 'rider-dup', ownerUserId: 'u', origin: 'rider', sha256: 'same' }),
    ).rejects.toThrow(/routes_owner_origin_sha_unique/);
    await routesRider.up(h.db);
    await routesRider.up(h.db);
    await docs.deleteMany({ _id: { $in: ['platform-copy', 'rider-copy'] } });
    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toEqual(before);
  });

  it('0022_routes_derived: коллекция route_exports, индекс бэкфилла; после 0021; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.at(-1)).toBe('0022_routes_derived');
    expect(ids.indexOf('0022_routes_derived')).toBe(ids.indexOf('0021_routes_rider') + 1);
    const exists = () =>
      h.db.listCollections({ name: ROUTES_COLLECTIONS.exports }, { nameOnly: true }).toArray();
    const expected = {
      route_geometries_derived_idx: {
        key: { derivedVersion: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(ROUTES_COLLECTIONS.exports)).toEqual({});
    expect(await indexesOf(ROUTES_COLLECTIONS.geometries)).toEqual(expected);
    await routesDerived.up(h.db);
    await routesDerived.up(h.db);
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(ROUTES_COLLECTIONS.geometries)).toEqual(expected);
  });

  it('0004_profile: коллекция profiles без индексов сверх _id; повторный up — без ошибки', async () => {
    const exists = () =>
      h.db.listCollections({ name: PROFILE_COLLECTIONS.profiles }, { nameOnly: true }).toArray();
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toEqual({});

    await h.db.collection(PROFILE_COLLECTIONS.profiles).drop();
    await profile.up(h.db);
    await profile.up(h.db);
    expect(await exists()).toHaveLength(1);
  });

  it('индексы identity: имена, ключи, unique, partialFilterExpression; TTL 30 дней (Q2)', async () => {
    const ttl = (collection: string) => ({
      [`${collection}_expires_at_ttl`]: {
        key: { expiresAt: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: IDENTITY_TTL_SECONDS,
      },
    });
    const plain = (key: Record<string, number>, unique = false, partial?: object) => ({
      key,
      unique,
      partialFilterExpression: partial,
      expireAfterSeconds: undefined,
    });
    const active = { usedAt: { $eq: null }, supersededAt: { $eq: null } };
    const links = (collection: string) => ({
      [`${collection}_token_hash_unique`]: plain({ tokenHash: 1 }, true),
      [`${collection}_user_id_idx`]: plain({ userId: 1, createdAt: -1 }),
      [`${collection}_active_unique`]: plain({ userId: 1 }, true, active),
      ...ttl(collection),
    });

    expect(await indexesOf(IDENTITY_COLLECTIONS.users)).toEqual({
      users_email_unique: plain({ email: 1 }, true),
      users_unverified_created_at_idx: plain({ createdAt: 1 }, false, {
        emailVerifiedAt: { $eq: null },
        deletedAt: { $eq: null },
      }),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.userConsents)).toEqual({
      user_consents_user_id_idx: plain({ userId: 1 }),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.emailVerificationTokens)).toEqual(
      links(IDENTITY_COLLECTIONS.emailVerificationTokens),
    );
    expect(await indexesOf(IDENTITY_COLLECTIONS.passwordResetTokens)).toEqual(
      links(IDENTITY_COLLECTIONS.passwordResetTokens),
    );
    expect(await indexesOf(IDENTITY_COLLECTIONS.registrationTokens)).toEqual({
      registration_tokens_user_id_unique: plain({ userId: 1 }, true),
      registration_tokens_token_hash_unique: plain({ tokenHash: 1 }, true),
      ...ttl(IDENTITY_COLLECTIONS.registrationTokens),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.sessions)).toEqual({
      sessions_refresh_token_hash_unique: plain({ refreshTokenHash: 1 }, true),
      sessions_previous_refresh_token_hash_unique: plain({ previousRefreshTokenHash: 1 }, true, {
        previousRefreshTokenHash: { $type: 'string' },
      }),
      sessions_user_id_idx: plain({ userId: 1 }),
      ...ttl(IDENTITY_COLLECTIONS.sessions),
    });
    // каждая коллекция identity покрыта миграцией
    expect(Object.keys(IDENTITY_INDEXES).sort()).toEqual(
      Object.values(IDENTITY_COLLECTIONS).sort(),
    );
  });

  it('повторный прогон — новых миграций нет; повторный up — те же индексы без ошибки', async () => {
    const before = await Promise.all(Object.values(IDENTITY_COLLECTIONS).map(indexesOf));

    expect(await runMongoMigrations({ db: h.db, migrations })).toEqual({ applied: [] });
    for (const migration of migrations) await migration.up(h.db);

    expect(await Promise.all(Object.values(IDENTITY_COLLECTIONS).map(indexesOf))).toEqual(before);
  });
});
