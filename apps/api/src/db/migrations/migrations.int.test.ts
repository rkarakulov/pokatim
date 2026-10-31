import { CITY_CENTERS } from '@pokatim/contracts';
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
import { accountDeletion } from './0023_account_deletion';
import { platformSettings } from './0024_platform_settings';
import { entryTier, LEGACY_RANKING_INDEX } from './0028_entry_tier';
import { routesPublication } from './0029_routes_publication';
import { standings } from './0030_standings';
import { STANDINGS_COLLECTIONS } from '../../modules/standings/standings.collection';
import { CITY_CENTERS_0031, ridesGeo } from './0031_rides_geo';
import { routeRides } from './0032_route_rides';
import { ROUTE_RIDES_COLLECTIONS } from '../../modules/route-rides/route-rides.collection';
import { RIDER_PROFILE_INDEXES, riderProfile } from './0033_rider_profile';
import { PROFILE_REPORTS_INDEXES, profileReports } from './0034_profile_reports';
import { ACHIEVEMENTS_INDEXES, achievements } from './0035_achievements';
import { ACHIEVEMENTS_COLLECTIONS } from '../../modules/achievements/achievements.collection';
import { overviewIndexes } from './0036_overview_indexes';
import { OG_SYNC_INDEXES, ogSyncIndexes } from './0037_og_sync_indexes';
import { tickets } from './0038_tickets';
import { eventMaterials } from './0039_event_materials';
import { MATERIALS_COLLECTIONS } from '../../modules/tickets/materials.collection';
import { panelTotp, PANEL_TOTP_TTL_GRACE_SECONDS } from './0040_panel_totp';
import { panelInvitations } from './0041_panel_invitations';
import {
  PROFILE_REPORT_REASONS_INDEXES,
  profileReportReasons,
} from './0042_profile_report_reasons';
import { ACHIEVEMENT_SEASON_INDEXES, achievementsSeasonal } from './0043_achievements_seasonal';
import { ROUTE_RIDES_PASSED_INDEX, routeRidesPassedIdx } from './0044_route_rides_passed_idx';
import { social } from './0045_social';
import { ridePhotos } from './0046_ride_photos';
import { RIDE_PHOTOS_COLLECTIONS } from '../../modules/rides/ride-photos.collection';
import { SOCIAL_COLLECTIONS } from '../../modules/social/social.collection';
import { PRODUCT_EVENTS_COLLECTIONS } from '../../modules/product-events/product-events.collection';
import { TICKETS_COLLECTIONS } from '../../modules/tickets/tickets.collection';
import { PROFILE_REPORTS_COLLECTIONS } from '../../modules/profile/profile-reports.collection';
import { ROUTE_REPORTS_COLLECTIONS } from '../../modules/routes/route-reports.collection';
import { APPEARANCE_COLLECTIONS } from '../../modules/appearance/appearance.collection';
import { notifications } from './0025_notifications';
import { attemptLastVerdict } from './0026_attempt_last_verdict';
import { pushTicketsUser } from './0027_push_tickets_user';
import { NOTIFICATIONS_COLLECTIONS } from '../../modules/notifications/notifications.collection';
import { DISPUTES_COLLECTIONS } from '../../modules/disputes/disputes.collection';
import { RIDE_REPORTS_COLLECTIONS } from '../../modules/rides/ride-reports.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';
import { TRACKS_COLLECTIONS } from '../../modules/tracks/tracks.collection';
import { DEVICES_COLLECTIONS } from '../../modules/devices/devices.collection';
import { migrations } from './index';

/** Частичные индексы очередей модерации маршрутов райдеров (`0029_routes_publication`). */
const ROUTES_PUBLICATION_QUEUES = {
  routes_publication_pending_idx: {
    key: { 'publication.submittedAt': 1, _id: 1 },
    unique: false,
    partialFilterExpression: { 'publication.status': 'pending' },
    expireAfterSeconds: undefined,
  },
  routes_publication_reports_idx: {
    key: { 'publication.lastReportAt': -1, _id: -1 },
    unique: false,
    partialFilterExpression: { 'publication.openReportCount': { $gt: 0 } },
    expireAfterSeconds: undefined,
  },
  routes_publication_hidden_idx: {
    key: { 'publication.hiddenAt': -1, _id: -1 },
    unique: false,
    partialFilterExpression: { 'publication.status': 'hidden' },
    expireAfterSeconds: undefined,
  },
};

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
      '0023_account_deletion',
      '0024_platform_settings',
      '0025_notifications',
      '0026_attempt_last_verdict',
      '0027_push_tickets_user',
      '0028_entry_tier',
      '0029_routes_publication',
      '0030_standings',
      '0031_rides_geo',
      '0032_route_rides',
      '0033_rider_profile',
      '0034_profile_reports',
      '0035_achievements',
      '0036_overview_indexes',
      '0037_og_sync_indexes',
      '0038_tickets',
      '0039_event_materials',
      '0040_panel_totp',
      '0041_panel_invitations',
      '0042_profile_report_reasons',
      '0043_achievements_seasonal',
      '0044_route_rides_passed_idx',
      '0045_social',
      '0046_ride_photos',
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
      // 0030_standings (race-results-08, RC-4): гонки с опубликованным протоколом для регламента рейтинга
      races_protocol_idx: {
        ...plain({ seasonId: 1, windowEndsAt: 1, _id: 1 }),
        partialFilterExpression: { protocolPublishedAt: { $type: 'date' } },
      },
      // 0037_og_sync_indexes (og-images): пререндер OG-картинок
      races_og_sync_idx: plain({ status: 1, updatedAt: 1, _id: 1 }),
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
      // 0037_og_sync_indexes (og-images): пререндер OG-картинок
      calendar_starts_og_sync_idx: plain({ status: 1, updatedAt: 1, _id: 1 }),
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
        // 0036_overview_indexes: KPI «Обзора» панели
        track_uploads_created_at_idx: index({ createdAt: 1 }),
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
        // 0023_account_deletion: стирание данных устройств пользователя
        device_connections_user_idx: index({ userId: 1 }),
      },
      [DEVICES_COLLECTIONS.tickets]: {
        device_link_tickets_ttl: index({ expiresAt: 1 }, false, undefined, 0),
        device_link_tickets_user_idx: index({ userId: 1 }),
      },
      [DEVICES_COLLECTIONS.imports]: {
        device_imports_workout_unique: index({ provider: 1, aggWorkoutId: 1 }, true),
        device_imports_upload_idx: index({ uploadId: 1 }, false, { uploadId: { $type: 'string' } }),
        device_imports_user_idx: index({ userId: 1 }),
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
        // 0029_routes_publication (routes-06): очереди модерации маршрутов райдеров
        ...ROUTES_PUBLICATION_QUEUES,
        // 0031_rides_geo (05c): старты маршрутов каталога в круге «Рядом»
        routes_start_2dsphere: index({ start: '2dsphere' }),
        // 0037_og_sync_indexes (og-images): пререндер OG-картинок
        routes_og_sync_idx: index({ status: 1, updatedAt: 1, _id: 1 }),
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
    // индексы 0015 (старый индекс мест удалён 0028_entry_tier; новые индексы 0028 — в своём тесте)
    const own = async (name: string, indexes: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(await indexesOf(name)).filter(([key]) => key in indexes));
    const { [LEGACY_RANKING_INDEX]: legacy, ...entriesAfter0028 } =
      expected[RESULTS_COLLECTIONS.entries];
    expect(await own(RESULTS_COLLECTIONS.entries, expected[RESULTS_COLLECTIONS.entries])).toEqual(
      entriesAfter0028,
    );
    expect(await own(RESULTS_COLLECTIONS.attempts, expected[RESULTS_COLLECTIONS.attempts])).toEqual(
      expected[RESULTS_COLLECTIONS.attempts],
    );

    // гонка до слайса заявок (без поля) и гонка с заявками — бэкфилл трогает только первую
    const races = h.db.collection<{ _id: string; lockedAt?: unknown }>(RACES_COLLECTIONS.races);
    const lockedAt = new Date('2026-10-24T10:00:00Z');
    await races.insertMany([{ _id: 'old-race' }, { _id: 'locked-race', lockedAt }]);
    await results.up(h.db);
    await results.up(h.db);
    expect(await races.findOne({ _id: 'old-race' })).toEqual({ _id: 'old-race', lockedAt: null });
    expect(await races.findOne({ _id: 'locked-race' })).toEqual({ _id: 'locked-race', lockedAt });
    await races.deleteMany({ _id: { $in: ['old-race', 'locked-race'] } });

    // повтор 0015 заново создаёт старый индекс мест (RC-17: рядом с новым — тот же ключ, другой частичный фильтр)
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await own(name, indexes)).toEqual(indexes);
    }
    expect(legacy).toBeDefined();
    // …следующая 0028 его снова удаляет
    await entryTier.up(h.db);
    expect((await indexesOf(RESULTS_COLLECTIONS.entries))[LEGACY_RANKING_INDEX]).toBeUndefined();
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
        // 0028_entry_tier (race-results-07): строки протокола по группе
        race_protocol_rows_group_idx: index({ raceId: 1, revision: 1, groupKey: 1, order: 1 }),
        // 0033_rider_profile: строки райдера по всем ревизиям
        race_protocol_rows_user_idx: index({ userId: 1, raceId: 1, revision: -1 }),
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

  it('0023_account_deletion: индексы userId данных устройств и частичный индекс очистки users; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0023_account_deletion')).toBe(ids.indexOf('0022_routes_derived') + 1);
    const plain = (key: Record<string, 1>) => ({
      key,
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const snapshot = async () => ({
      connections: (await indexesOf(DEVICES_COLLECTIONS.connections)).device_connections_user_idx,
      imports: (await indexesOf(DEVICES_COLLECTIONS.imports)).device_imports_user_idx,
      tickets: (await indexesOf(DEVICES_COLLECTIONS.tickets)).device_link_tickets_user_idx,
      users: (await indexesOf(IDENTITY_COLLECTIONS.users)).users_erasure_pending_idx,
    });
    const expected = {
      connections: plain({ userId: 1 }),
      imports: plain({ userId: 1 }),
      tickets: plain({ userId: 1 }),
      users: {
        key: { deletedAt: 1 },
        unique: false,
        partialFilterExpression: { deletedAt: { $type: 'date' }, erasureSweptAt: { $eq: null } },
        expireAfterSeconds: undefined,
      },
    };
    expect(await snapshot()).toEqual(expected);
    await accountDeletion.up(h.db);
    await accountDeletion.up(h.db);
    expect(await snapshot()).toEqual(expected);
  });

  it('0024_platform_settings: коллекция platform_settings без индексов сверх _id; повторный up — без ошибки', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0024_platform_settings')).toBe(ids.indexOf('0023_account_deletion') + 1);
    const exists = () =>
      h.db.listCollections({ name: APPEARANCE_COLLECTIONS.settings }, { nameOnly: true }).toArray();
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(APPEARANCE_COLLECTIONS.settings)).toEqual({});
    await platformSettings.up(h.db);
    await platformSettings.up(h.db);
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(APPEARANCE_COLLECTIONS.settings)).toEqual({});
  });

  it('0028_entry_tier: бэкфилл уровня, best.ranked и groupScheme; анкеты; индексы мест, финишёров и групп протокола; старый индекс мест удалён; последняя; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0028_entry_tier')).toBe(ids.indexOf('0027_push_tickets_user') + 1);
    const index = (key: Record<string, unknown>, partial?: Record<string, unknown>) => ({
      key,
      unique: false,
      partialFilterExpression: partial,
      expireAfterSeconds: undefined,
    });
    const snapshot = async () => ({
      entries: await indexesOf(RESULTS_COLLECTIONS.entries),
      group: (await indexesOf(RESULTS_COLLECTIONS.protocolRows)).race_protocol_rows_group_idx,
      verified: await h.db
        .listCollections({ name: PROFILE_COLLECTIONS.verified }, { nameOnly: true })
        .toArray(),
    });
    const before = await snapshot();
    expect(before.entries.race_entries_ranked_idx).toEqual(
      index(
        { raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
        { status: 'active', best: { $type: 'object' }, tier: 'verified', 'best.ranked': true },
      ),
    );
    expect(before.entries.race_entries_finishers_idx).toEqual(
      index(
        { raceId: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
        { status: 'active', best: { $type: 'object' }, 'best.ranked': false },
      ),
    );
    expect(before.entries[LEGACY_RANKING_INDEX]).toBeUndefined();
    expect(before.group).toEqual(index({ raceId: 1, revision: 1, groupKey: 1, order: 1 }));
    expect(before.verified).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.verified)).toEqual({});

    // документы до 07: заявка без уровня с лучшим, заявка без лучшего, уже новая START; гонки с заявками и без
    const entries = h.db.collection<{
      _id: string;
      raceId: string;
      userId: string;
      tier: unknown;
      best: unknown;
    }>(RESULTS_COLLECTIONS.entries);
    const best = { attemptId: 'a', elapsedSec: 60 };
    const doc = (_id: string, tier: unknown, value: unknown) => ({
      _id,
      raceId: 'r',
      userId: _id,
      tier,
      best: value,
    });
    await entries.insertMany([
      doc('old-best', null, best),
      doc('old-none', null, null),
      doc('new-start', 'start', { ...best, ranked: false }),
    ]);
    const races = h.db.collection<{ _id: string; lockedAt?: unknown; groupScheme?: unknown }>(
      RACES_COLLECTIONS.races,
    );
    const lockedAt = new Date('2026-10-24T10:00:00Z');
    await races.insertMany([
      { _id: 'locked-race', lockedAt },
      { _id: 'empty-race', lockedAt: null },
      { _id: 'new-race', lockedAt, groupScheme: 'gender_age' },
    ]);
    await entryTier.up(h.db);
    await entryTier.up(h.db);
    const entryIds = { _id: { $in: ['old-best', 'old-none', 'new-start'] } };
    const raceIds = { _id: { $in: ['locked-race', 'empty-race', 'new-race'] } };
    expect(await entries.find(entryIds, { sort: { _id: 1 } }).toArray()).toEqual([
      doc('new-start', 'start', { ...best, ranked: false }),
      doc('old-best', 'verified', { ...best, ranked: true }),
      doc('old-none', 'verified', null),
    ]);
    expect(await races.find(raceIds, { sort: { _id: 1 } }).toArray()).toEqual([
      { _id: 'empty-race', lockedAt: null, groupScheme: null },
      { _id: 'locked-race', lockedAt, groupScheme: 'overall' },
      { _id: 'new-race', lockedAt, groupScheme: 'gender_age' },
    ]);
    await entries.deleteMany(entryIds);
    await races.deleteMany(raceIds);
    expect(await snapshot()).toEqual(before);
  });

  it('0025_notifications: коллекции и индексы центра уведомлений (unique, partial, TTL); после 0024; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0025_notifications')).toBe(ids.indexOf('0024_platform_settings') + 1);
    const index = (
      key: Record<string, 1 | -1>,
      options: { unique?: boolean; partial?: Record<string, unknown>; ttl?: number } = {},
    ) => ({
      key,
      unique: options.unique ?? false,
      partialFilterExpression: options.partial,
      expireAfterSeconds: options.ttl,
    });
    const snapshot = async () => ({
      notifications: await indexesOf(NOTIFICATIONS_COLLECTIONS.notifications),
      settings: await indexesOf(NOTIFICATIONS_COLLECTIONS.settings),
      pushTokens: await indexesOf(NOTIFICATIONS_COLLECTIONS.pushTokens),
      pushTickets: await indexesOf(NOTIFICATIONS_COLLECTIONS.pushTickets),
    });
    const due = { $in: ['pending', 'sending'] };
    const expected = {
      notifications: {
        notifications_event_user_unique: index({ sourceEventId: 1, userId: 1 }, { unique: true }),
        notifications_collapse_unique: index(
          { userId: 1, collapseKey: 1 },
          { unique: true, partial: { collapseKey: { $type: 'string' } } },
        ),
        notifications_user_list_idx: index({ userId: 1, createdAt: -1, _id: -1 }),
        notifications_user_unread_idx: index({ userId: 1 }, { partial: { readAt: { $eq: null } } }),
        notifications_push_due_idx: index(
          { 'push.state': 1, 'push.notBefore': 1 },
          { partial: { 'push.state': due } },
        ),
        notifications_email_due_idx: index(
          { 'email.state': 1 },
          { partial: { 'email.state': due } },
        ),
        notifications_expire_ttl: index({ expireAt: 1 }, { ttl: 0 }),
      },
      settings: {},
      pushTokens: {
        push_tokens_token_unique: index({ token: 1 }, { unique: true }),
        push_tokens_user_idx: index({ userId: 1, updatedAt: 1 }),
      },
      pushTickets: {
        push_tickets_ticket_unique: index({ ticketId: 1 }, { unique: true }),
        push_tickets_created_idx: index({ createdAt: 1 }),
        push_tickets_expire_ttl: index({ expireAt: 1 }, { ttl: 0 }),
        // 0027_push_tickets_user
        push_tickets_user_idx: index({ userId: 1 }),
      },
    };
    expect(await snapshot()).toEqual(expected);
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(Object.values(NOTIFICATIONS_COLLECTIONS)));
    await notifications.up(h.db);
    await notifications.up(h.db);
    expect(await snapshot()).toEqual(expected);
  });

  it('0027_push_tickets_user: индекс владельца тикета; после 0026; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0027_push_tickets_user')).toBe(
      ids.indexOf('0026_attempt_last_verdict') + 1,
    );
    const before = await indexesOf(NOTIFICATIONS_COLLECTIONS.pushTickets);
    expect(before.push_tickets_user_idx).toEqual({
      key: { userId: 1 },
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    await pushTicketsUser.up(h.db);
    await pushTicketsUser.up(h.db);
    expect(await indexesOf(NOTIFICATIONS_COLLECTIONS.pushTickets)).toEqual(before);
  });

  it('0026_attempt_last_verdict: counted/rejected без поля получают lastVisibleVerdict = status, прочие — нет; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0026_attempt_last_verdict')).toBe(ids.indexOf('0025_notifications') + 1);
    const attemptsDb = h.db.collection<Record<string, unknown> & { _id: string }>(
      RESULTS_COLLECTIONS.attempts,
    );
    await attemptsDb.insertMany([
      { _id: 'a-counted', raceId: 'r', activityId: 'act-counted', status: 'counted' },
      { _id: 'a-rejected', raceId: 'r', activityId: 'act-rejected', status: 'rejected' },
      { _id: 'a-failed', raceId: 'r', activityId: 'act-failed', status: 'failed' },
      { _id: 'a-queued', raceId: 'r', activityId: 'act-queued', status: 'queued' },
      { _id: 'a-withdrawn', raceId: 'r', activityId: 'act-withdrawn', status: 'withdrawn' },
      {
        _id: 'a-kept',
        raceId: 'r',
        activityId: 'act-kept',
        status: 'counted',
        lastVisibleVerdict: 'rejected',
      },
    ]);
    await attemptLastVerdict.up(h.db);
    const snapshot = async () =>
      Object.fromEntries(
        (await attemptsDb.find().sort({ _id: 1 }).toArray()).map((doc) => [
          doc._id,
          doc.lastVisibleVerdict,
        ]),
      );
    const expected = {
      'a-counted': 'counted',
      'a-failed': undefined,
      'a-kept': 'rejected',
      'a-queued': undefined,
      'a-rejected': 'rejected',
      'a-withdrawn': undefined,
    };
    expect(await snapshot()).toEqual(expected);
    expect(await attemptsDb.findOne({ _id: 'a-failed' })).toEqual({
      _id: 'a-failed',
      raceId: 'r',
      activityId: 'act-failed',
      status: 'failed',
    });
    await attemptLastVerdict.up(h.db);
    expect(await snapshot()).toEqual(expected);
    await attemptsDb.deleteMany({ _id: { $regex: '^a-' } });
  });

  it('0029_routes_publication: жалобы на маршруты (unique), очереди модерации (partial); повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0029_routes_publication')).toBe(ids.indexOf('0028_entry_tier') + 1);
    const reports = {
      route_reports_route_reporter_unique: {
        key: { routeId: 1, reporterUserId: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      route_reports_route_idx: {
        key: { routeId: 1, _id: -1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(ROUTE_REPORTS_COLLECTIONS.reports)).toEqual(reports);
    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toMatchObject(ROUTES_PUBLICATION_QUEUES);
    await routesPublication.up(h.db);
    await routesPublication.up(h.db);
    expect(await indexesOf(ROUTE_REPORTS_COLLECTIONS.reports)).toEqual(reports);
    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toMatchObject(ROUTES_PUBLICATION_QUEUES);
  });

  it('0030_standings: снимок рейтинга сезона (unique страницы, /me) и частичный индекс гонок с протоколом; повторный up — без изменений (AC11)', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0030_standings')).toBe(ids.indexOf('0029_routes_publication') + 1);
    const exists = async (name: string) =>
      (await h.db.listCollections({ name }, { nameOnly: true }).toArray()).length === 1;
    expect(await exists(STANDINGS_COLLECTIONS.seasons)).toBe(true);
    const rows = {
      season_standing_rows_order_unique: {
        key: { seasonId: 1, bikeClass: 1, groupKey: 1, order: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      season_standing_rows_user_idx: {
        key: { seasonId: 1, userId: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    const protocolIdx = {
      races_protocol_idx: {
        key: { seasonId: 1, windowEndsAt: 1, _id: 1 },
        unique: false,
        partialFilterExpression: { protocolPublishedAt: { $type: 'date' } },
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(STANDINGS_COLLECTIONS.seasons)).toEqual({});
    expect(await indexesOf(STANDINGS_COLLECTIONS.rows)).toEqual(rows);
    expect(await indexesOf(RACES_COLLECTIONS.races)).toMatchObject(protocolIdx);
    await standings.up(h.db);
    await standings.up(h.db);
    expect(await exists(STANDINGS_COLLECTIONS.seasons)).toBe(true);
    expect(await indexesOf(STANDINGS_COLLECTIONS.rows)).toEqual(rows);
    expect(await indexesOf(RACES_COLLECTIONS.races)).toMatchObject(protocolIdx);
  });

  it('0032_route_rides: коллекция заездов по маршруту и уникальный индекс (userId, routeId, activityId); после 0031; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0032_route_rides')).toBe(ids.indexOf('0031_rides_geo') + 1);
    const exists = async () =>
      (
        await h.db
          .listCollections({ name: ROUTE_RIDES_COLLECTIONS.rides }, { nameOnly: true })
          .toArray()
      ).length === 1;
    const expected = {
      route_rides_user_route_activity_unique: {
        key: { userId: 1, routeId: 1, activityId: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    // 0044_route_rides_passed_idx добавляет второй индекс — его проверяет свой тест
    expect(await exists()).toBe(true);
    expect(await indexesOf(ROUTE_RIDES_COLLECTIONS.rides)).toMatchObject(expected);
    await routeRides.up(h.db);
    await routeRides.up(h.db);
    expect(await exists()).toBe(true);
    expect(await indexesOf(ROUTE_RIDES_COLLECTIONS.rides)).toMatchObject(expected);
  });

  it('0031_rides_geo: бэкфилл точки «Рядом» (центр города) и routeId; индексы 2dsphere (rides.geo, routes.start); повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0031_rides_geo')).toBe(ids.indexOf('0030_standings') + 1);
    // снимок центров в миграции = справочник контрактов на момент миграции (все 25 кодов)
    expect(CITY_CENTERS_0031).toEqual(CITY_CENTERS);
    const geoIndex = {
      rides_geo_feed_idx: {
        key: { geo: '2dsphere', startsAt: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toMatchObject(geoIndex);
    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toMatchObject({
      routes_start_2dsphere: {
        key: { start: '2dsphere' },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    });

    // райд до 05c (без полей) и райд с точной точкой — бэкфилл трогает только отсутствующие поля
    const ridesDb = h.db.collection<Record<string, unknown> & { _id: string }>(
      RIDES_COLLECTIONS.rides,
    );
    const precise = {
      _id: 'precise-ride',
      cityCode: 'minsk',
      startsAt: new Date('2027-06-14T07:00:00Z'),
      routeId: 'route-1',
      geo: { type: 'Point', coordinates: [27.61, 53.95] },
      startPrecise: true,
    };
    await ridesDb.insertMany([
      { _id: 'old-ride', cityCode: 'brest', startsAt: new Date('2027-06-14T07:00:00Z') },
      precise,
    ]);
    await ridesGeo.up(h.db);
    const backfilled = await ridesDb.findOne({ _id: 'old-ride' });
    expect(backfilled).toEqual({
      _id: 'old-ride',
      cityCode: 'brest',
      startsAt: new Date('2027-06-14T07:00:00Z'),
      geo: { type: 'Point', coordinates: [...CITY_CENTERS.brest] },
      startPrecise: false,
      routeId: null,
    });
    expect(await ridesDb.findOne({ _id: 'precise-ride' })).toEqual(precise);
    const indexes = await indexesOf(RIDES_COLLECTIONS.rides);
    const routeIndexes = await indexesOf(ROUTES_COLLECTIONS.routes);
    await ridesGeo.up(h.db);
    expect(await ridesDb.findOne({ _id: 'old-ride' })).toEqual(backfilled);
    expect(await ridesDb.findOne({ _id: 'precise-ride' })).toEqual(precise);
    expect(await indexesOf(RIDES_COLLECTIONS.rides)).toEqual(indexes);
    expect(await indexesOf(ROUTES_COLLECTIONS.routes)).toEqual(routeIndexes);
    await ridesDb.deleteMany({ _id: { $in: ['old-ride', 'precise-ride'] } });
  });

  it('0004_profile: коллекция profiles (индексов сверх _id нет до 0033); повторный up — без ошибки', async () => {
    const exists = () =>
      h.db.listCollections({ name: PROFILE_COLLECTIONS.profiles }, { nameOnly: true }).toArray();
    expect(await exists()).toHaveLength(1);
    expect(Object.keys(await indexesOf(PROFILE_COLLECTIONS.profiles)).sort()).toEqual(
      [
        RIDER_PROFILE_INDEXES.profilesPublicId.options.name,
        PROFILE_REPORTS_INDEXES.profilesReportQueue.options.name,
        PROFILE_REPORT_REASONS_INDEXES.profilesReportReasonQueue.options.name,
      ].sort(),
    );

    await h.db.collection(PROFILE_COLLECTIONS.profiles).drop();
    await profile.up(h.db);
    await profile.up(h.db);
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toEqual({});
    // индексы publicId (0033) и очереди жалоб (0034, 0041) — обратно: следующие файлы стенда работают с той же базой
    await riderProfile.up(h.db);
    await profileReports.up(h.db);
    await profileReportReasons.up(h.db);
  });

  it('0033_rider_profile: бэкфилл publicId (имя + согласие) и raceWindowStartsAt; profile_avatars; индексы; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0033_rider_profile')).toBe(ids.indexOf('0032_route_rides') + 1);

    const avatarsExist = await h.db
      .listCollections({ name: PROFILE_COLLECTIONS.avatars }, { nameOnly: true })
      .toArray();
    expect(avatarsExist).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toMatchObject({
      profiles_public_id_unique: {
        key: { publicId: 1 },
        unique: true,
        partialFilterExpression: { publicId: { $type: 'string' } },
        expireAfterSeconds: undefined,
      },
    });
    expect(await indexesOf(PROFILE_COLLECTIONS.avatars)).toEqual({
      profile_avatars_user_idx: {
        key: { userId: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    });
    expect(await indexesOf(RESULTS_COLLECTIONS.entries)).toMatchObject({
      race_entries_user_history_idx: {
        key: { userId: 1, status: 1, raceWindowStartsAt: -1, _id: -1 },
        unique: false,
      },
      // прежний индекс заявок пользователя остаётся (expand-only)
      race_entries_user_idx: expect.any(Object),
    });
    expect(await indexesOf(RESULTS_COLLECTIONS.protocolRows)).toMatchObject({
      race_protocol_rows_user_idx: { key: { userId: 1, raceId: 1, revision: -1 }, unique: false },
    });

    type Loose = Record<string, unknown> & { _id: string };
    const profiles = h.db.collection<Loose>(PROFILE_COLLECTIONS.profiles);
    const entries = h.db.collection<Loose>(RESULTS_COLLECTIONS.entries);
    const racesDb = h.db.collection<Loose>(RACES_COLLECTIONS.races);
    const windowStartsAt = new Date('2026-06-01T05:00:00Z');
    await profiles.insertMany([
      { _id: 'shown', publicName: 'Анна', showNameInResults: true },
      { _id: 'hidden', publicName: 'Борис', showNameInResults: false },
      { _id: 'nameless', publicName: null, showNameInResults: true },
      { _id: 'kept', publicName: 'Вера', showNameInResults: true, publicId: 'k'.repeat(43) },
    ]);
    await racesDb.insertOne({ _id: 'race-0033', windowStartsAt });
    await entries.insertMany([
      { _id: 'entry-old', raceId: 'race-0033', userId: 'u1' },
      { _id: 'entry-orphan', raceId: 'race-missing', userId: 'u1' },
    ]);

    await riderProfile.up(h.db);
    const shown = await profiles.findOne({ _id: 'shown' });
    expect(shown?.publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await profiles.findOne({ _id: 'hidden' }))?.publicId).toBeUndefined();
    expect((await profiles.findOne({ _id: 'nameless' }))?.publicId).toBeUndefined();
    expect((await profiles.findOne({ _id: 'kept' }))?.publicId).toBe('k'.repeat(43));
    expect((await entries.findOne({ _id: 'entry-old' }))?.raceWindowStartsAt).toEqual(
      windowStartsAt,
    );
    expect((await entries.findOne({ _id: 'entry-orphan' }))?.raceWindowStartsAt).toBeUndefined();

    const before = {
      profiles: await indexesOf(PROFILE_COLLECTIONS.profiles),
      entries: await indexesOf(RESULTS_COLLECTIONS.entries),
    };
    await riderProfile.up(h.db);
    expect((await profiles.findOne({ _id: 'shown' }))?.publicId).toBe(shown?.publicId);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toEqual(before.profiles);
    expect(await indexesOf(RESULTS_COLLECTIONS.entries)).toEqual(before.entries);
    await profiles.deleteMany({ _id: { $in: ['shown', 'hidden', 'nameless', 'kept'] } });
    await entries.deleteMany({ _id: { $in: ['entry-old', 'entry-orphan'] } });
    await racesDb.deleteOne({ _id: 'race-0033' });
  });

  it('0034_profile_reports: коллекция profile_reports, индексы «одна открытая», цели и очереди; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0034_profile_reports')).toBe(ids.indexOf('0033_rider_profile') + 1);

    const exists = await h.db
      .listCollections({ name: PROFILE_REPORTS_COLLECTIONS.reports }, { nameOnly: true })
      .toArray();
    expect(exists).toHaveLength(1);
    const reportIndexes = {
      profile_reports_open_unique: {
        key: { targetUserId: 1, reporterUserId: 1 },
        unique: true,
        partialFilterExpression: { resolvedAt: { $eq: null } },
        expireAfterSeconds: undefined,
      },
      profile_reports_target_idx: {
        key: { targetUserId: 1, _id: -1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(PROFILE_REPORTS_COLLECTIONS.reports)).toEqual(reportIndexes);
    const queueIndex = {
      profiles_report_queue_idx: {
        key: { lastReportAt: -1, _id: -1 },
        unique: false,
        partialFilterExpression: { openReportCount: { $gt: 0 } },
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toMatchObject(queueIndex);

    // одна открытая жалоба на (цель, жалобщик); закрытая из индекса выходит — новая вставляется
    const reports = h.db.collection<Record<string, unknown> & { _id: string }>(
      PROFILE_REPORTS_COLLECTIONS.reports,
    );
    const base = { targetUserId: 't-0034', reporterUserId: 'r-0034', resolution: null };
    await reports.insertOne({ _id: 'rep-1', ...base, resolvedAt: null });
    await expect(reports.insertOne({ _id: 'rep-2', ...base, resolvedAt: null })).rejects.toThrow(
      /duplicate key/,
    );
    await reports.updateOne({ _id: 'rep-1' }, { $set: { resolvedAt: new Date() } });
    await reports.insertOne({ _id: 'rep-2', ...base, resolvedAt: null });
    await reports.deleteMany({ _id: { $in: ['rep-1', 'rep-2'] } });

    await profileReports.up(h.db);
    await profileReports.up(h.db);
    expect(await indexesOf(PROFILE_REPORTS_COLLECTIONS.reports)).toEqual(reportIndexes);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toMatchObject(queueIndex);
  });

  it('0035_achievements: коллекции выдач и маркера, уникальный (userId, code); повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0035_achievements')).toBe(ids.indexOf('0034_profile_reports') + 1);

    for (const name of Object.values(ACHIEVEMENTS_COLLECTIONS)) {
      expect(await h.db.listCollections({ name }, { nameOnly: true }).toArray()).toHaveLength(1);
    }
    const grantIndexes = {
      [ACHIEVEMENTS_INDEXES.grantsUserCodeUnique.options.name]: {
        key: { userId: 1, code: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(ACHIEVEMENTS_COLLECTIONS.grants)).toEqual(grantIndexes);
    expect(await indexesOf(ACHIEVEMENTS_COLLECTIONS.syncs)).toEqual({});

    // одна выдача на (пользователь, код); другой код или пользователь — вставляется
    const grants = h.db.collection<Record<string, unknown> & { _id: string }>(
      ACHIEVEMENTS_COLLECTIONS.grants,
    );
    await grants.insertOne({ _id: 'g-1', userId: 'u-0035', code: 'race_win' });
    await expect(
      grants.insertOne({ _id: 'g-2', userId: 'u-0035', code: 'race_win' }),
    ).rejects.toThrow(/duplicate key/);
    await grants.insertOne({ _id: 'g-3', userId: 'u-0035', code: 'race_podium' });
    await grants.insertOne({ _id: 'g-4', userId: 'v-0035', code: 'race_win' });
    await grants.deleteMany({ _id: { $in: ['g-1', 'g-3', 'g-4'] } });

    await achievements.up(h.db);
    await achievements.up(h.db);
    expect(await indexesOf(ACHIEVEMENTS_COLLECTIONS.grants)).toEqual(grantIndexes);
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
      // 0023_account_deletion: регламент повторного прохода очистки удалённых
      users_erasure_pending_idx: plain({ deletedAt: 1 }, false, {
        deletedAt: { $type: 'date' },
        erasureSweptAt: { $eq: null },
      }),
      // 0036_overview_indexes: KPI «Обзора» панели
      users_created_at_idx: plain({ createdAt: 1 }),
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

  it('0036_overview_indexes: индексы createdAt пользователей и загрузок; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0036_overview_indexes')).toBe(ids.indexOf('0035_achievements') + 1);
    const createdAt = {
      key: { createdAt: 1 },
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    };
    expect(await indexesOf(IDENTITY_COLLECTIONS.users)).toMatchObject({
      users_created_at_idx: createdAt,
    });
    expect(await indexesOf(TRACKS_COLLECTIONS.uploads)).toMatchObject({
      track_uploads_created_at_idx: createdAt,
    });
    await overviewIndexes.up(h.db);
    await overviewIndexes.up(h.db);
    expect(await indexesOf(IDENTITY_COLLECTIONS.users)).toMatchObject({
      users_created_at_idx: createdAt,
    });
  });

  it('0037_og_sync_indexes: (status, updatedAt, _id) на 4 коллекциях; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0037_og_sync_indexes')).toBe(ids.indexOf('0036_overview_indexes') + 1);
    const ogSync = {
      key: { status: 1, updatedAt: 1, _id: 1 },
      unique: false,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    };
    const target = {
      [RACES_COLLECTIONS.races]: OG_SYNC_INDEXES.races.options.name,
      [RIDES_COLLECTIONS.rides]: OG_SYNC_INDEXES.rides.options.name,
      [ROUTES_COLLECTIONS.routes]: OG_SYNC_INDEXES.routes.options.name,
      [CALENDAR_COLLECTIONS.starts]: OG_SYNC_INDEXES.calendar.options.name,
    };
    const check = async () => {
      for (const [collection, name] of Object.entries(target)) {
        expect(await indexesOf(collection)).toMatchObject({ [name]: ogSync });
      }
    };
    await check();
    await ogSyncIndexes.up(h.db);
    await ogSyncIndexes.up(h.db);
    await check();
  });

  it('0038_tickets: коллекции и индексы билетов; последняя; уникальности; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0038_tickets')).toBe(ids.indexOf('0037_og_sync_indexes') + 1);
    const index = (key: Record<string, number>, unique = false, partial?: object) => ({
      key,
      unique,
      partialFilterExpression: partial,
      expireAfterSeconds: undefined,
    });
    const expected = {
      [TICKETS_COLLECTIONS.tickets]: {
        tickets_code_unique: index({ code: 1 }, true),
        tickets_qr_hash_unique: index({ qrHash: 1 }, true),
        tickets_registration_unique: index({ registrationId: 1 }, true),
        tickets_user_idx: index({ userId: 1, createdAt: -1 }),
        tickets_event_idx: index({ kind: 1, eventId: 1, _id: 1 }),
      },
      [TICKETS_COLLECTIONS.registrations]: {
        event_registrations_active_unique: index({ eventId: 1, userId: 1 }, true, {
          status: 'active',
        }),
        event_registrations_user_idx: index({ userId: 1, createdAt: -1 }),
      },
      [TICKETS_COLLECTIONS.ticketing]: {
        event_ticketing_enabled_idx: index({ kind: 1, enabled: 1, startsAt: 1 }),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }

    // одна активная регистрация на (событие, пользователь); отменённая выходит из индекса
    const registrations = h.db.collection<Record<string, unknown> & { _id: string }>(
      TICKETS_COLLECTIONS.registrations,
    );
    await registrations.insertOne({
      _id: 'r-1',
      eventId: 'e-0037',
      userId: 'u-0037',
      status: 'active',
    });
    await expect(
      registrations.insertOne({
        _id: 'r-2',
        eventId: 'e-0037',
        userId: 'u-0037',
        status: 'active',
      }),
    ).rejects.toThrow(/duplicate key/);
    await registrations.updateOne({ _id: 'r-1' }, { $set: { status: 'cancelled' } });
    await registrations.insertOne({
      _id: 'r-3',
      eventId: 'e-0037',
      userId: 'u-0037',
      status: 'active',
    });
    await registrations.deleteMany({ _id: { $in: ['r-1', 'r-3'] } });

    await tickets.up(h.db);
    await tickets.up(h.db);
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0039_event_materials: уникальный порядок материалов события; после 0038; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0039_event_materials')).toBe(ids.indexOf('0038_tickets') + 1);
    const expected = {
      event_materials_event_order_unique: {
        key: { kind: 1, eventId: 1, order: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    const collections = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(
      (c) => c.name,
    );
    expect(collections).toEqual(
      expect.arrayContaining([
        MATERIALS_COLLECTIONS.materials,
        MATERIALS_COLLECTIONS.files,
        MATERIALS_COLLECTIONS.locks,
      ]),
    );
    expect(await indexesOf(MATERIALS_COLLECTIONS.materials)).toEqual(expected);
    expect(await indexesOf(MATERIALS_COLLECTIONS.files)).toEqual({});
    expect(await indexesOf(MATERIALS_COLLECTIONS.locks)).toEqual({});

    const materials = h.db.collection<Record<string, unknown> & { _id: string }>(
      MATERIALS_COLLECTIONS.materials,
    );
    await materials.insertOne({ _id: 'm-1', kind: 'race', eventId: 'e-0039', order: 0 });
    await expect(
      materials.insertOne({ _id: 'm-2', kind: 'race', eventId: 'e-0039', order: 0 }),
    ).rejects.toThrow(/duplicate key/);
    await materials.insertOne({ _id: 'm-3', kind: 'calendar', eventId: 'e-0039', order: 0 });
    await materials.deleteMany({ _id: { $in: ['m-1', 'm-3'] } });

    await eventMaterials.up(h.db);
    await eventMaterials.up(h.db);
    expect(await indexesOf(MATERIALS_COLLECTIONS.materials)).toEqual(expected);
  });

  it('0040_panel_totp: коллекции 2FA, уникальные хеши токенов, TTL; повторный up не меняет индексы', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0040_panel_totp')).toBe(ids.indexOf('0039_event_materials') + 1);
    const index = (key: Record<string, number>, unique = false, ttl?: number) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: ttl,
    });
    const expected = {
      [PANEL_COLLECTIONS.totp]: {},
      [PANEL_COLLECTIONS.challenges]: {
        panel_challenges_token_hash_unique: index({ tokenHash: 1 }, true),
        panel_challenges_expires_at_ttl: index(
          { expiresAt: 1 },
          false,
          PANEL_TOTP_TTL_GRACE_SECONDS,
        ),
      },
      [PANEL_COLLECTIONS.devices]: {
        panel_devices_token_hash_unique: index({ tokenHash: 1 }, true),
        panel_devices_user_idx: index({ userId: 1, createdAt: -1 }),
        panel_devices_expires_at_ttl: index({ expiresAt: 1 }, false, PANEL_TOTP_TTL_GRACE_SECONDS),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
    await panelTotp.up(h.db);
    await panelTotp.up(h.db);
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0041_panel_invitations: уникальный хеш токена, одно pending на адрес, список, TTL уборки; последняя, повторный up не меняет индексы', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids).toContain('0041_panel_invitations');
    expect(ids.indexOf('0041_panel_invitations')).toBe(ids.indexOf('0040_panel_totp') + 1);
    const expected = {
      panel_invitations_token_hash_unique: {
        key: { tokenHash: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      panel_invitations_pending_email_unique: {
        key: { email: 1 },
        unique: true,
        partialFilterExpression: { status: 'pending' },
        expireAfterSeconds: undefined,
      },
      panel_invitations_status_created_idx: {
        key: { status: 1, createdAt: -1, _id: -1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      panel_invitations_purge_ttl: {
        key: { purgeAt: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: 0,
      },
    };
    expect(await indexesOf(PANEL_COLLECTIONS.invitations)).toEqual(expected);

    // одно pending на адрес; закрытые (email: null) и другие статусы — не мешают
    const invitations = h.db.collection<{
      _id: string;
      email: string | null;
      status: string;
      tokenHash: string;
    }>(PANEL_COLLECTIONS.invitations);
    await invitations.insertOne({
      _id: 'i-1',
      email: 'a@example.by',
      status: 'pending',
      tokenHash: 'h1',
    });
    await expect(
      invitations.insertOne({
        _id: 'i-2',
        email: 'a@example.by',
        status: 'pending',
        tokenHash: 'h2',
      }),
    ).rejects.toThrow(/duplicate key/);
    await invitations.insertOne({ _id: 'i-3', email: null, status: 'revoked', tokenHash: 'h3' });
    await invitations.insertOne({ _id: 'i-4', email: null, status: 'accepted', tokenHash: 'h4' });
    await invitations.deleteMany({ _id: { $in: ['i-1', 'i-3', 'i-4'] } });

    await panelInvitations.up(h.db);
    await panelInvitations.up(h.db);
    expect(await indexesOf(PANEL_COLLECTIONS.invitations)).toEqual(expected);
  });

  it('0042_profile_report_reasons: индекс очереди по причине, бэкфилл openReasons по открытым жалобам; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0042_profile_report_reasons')).toBe(
      ids.indexOf('0041_panel_invitations') + 1,
    );
    const reasonIndex = {
      profiles_report_reason_queue_idx: {
        key: { openReasons: 1, lastReportAt: -1, _id: -1 },
        unique: false,
        partialFilterExpression: { openReportCount: { $gt: 0 } },
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toMatchObject(reasonIndex);

    const profiles = h.db.collection<Record<string, unknown> & { _id: string }>(
      PROFILE_COLLECTIONS.profiles,
    );
    const reports = h.db.collection<Record<string, unknown> & { _id: string }>(
      PROFILE_REPORTS_COLLECTIONS.reports,
    );
    const at = new Date('2026-10-30T08:00:00.000Z');
    await profiles.insertMany([
      { _id: 'p-0041-open', openReportCount: 3, lastReportAt: at },
      { _id: 'p-0041-closed', openReportCount: 0, lastReportAt: at },
      { _id: 'p-0041-none' },
    ]);
    const report = (id: string, target: string, reason: string, resolvedAt: Date | null) => ({
      _id: id,
      targetUserId: target,
      reporterUserId: `r-${id}`,
      reason,
      resolvedAt,
    });
    await reports.insertMany([
      report('rep-0041-1', 'p-0041-open', 'name', null),
      report('rep-0041-2', 'p-0041-open', 'photo', null),
      report('rep-0041-3', 'p-0041-open', 'name', null),
      report('rep-0041-4', 'p-0041-open', 'club', at),
      report('rep-0041-5', 'p-0041-closed', 'spam', at),
    ]);
    try {
      const reasonsOf = async () =>
        Object.fromEntries(
          (await profiles.find({ _id: /^p-0041-/ }).toArray()).map((doc) => [
            doc._id,
            Array.isArray(doc.openReasons) ? [...(doc.openReasons as string[])].sort() : null,
          ]),
        );
      await profileReportReasons.up(h.db);
      const expected = {
        'p-0041-open': ['name', 'photo'],
        'p-0041-closed': null,
        'p-0041-none': null,
      };
      expect(await reasonsOf()).toEqual(expected);
      await profileReportReasons.up(h.db);
      expect(await reasonsOf()).toEqual(expected);
      expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toMatchObject(reasonIndex);
    } finally {
      await profiles.deleteMany({ _id: /^p-0041-/ });
      await reports.deleteMany({ _id: /^rep-0041-/ });
    }
  });

  it('0043_achievements_seasonal: коллекция сезонных выдач, уникальный (userId, code, seasonId); achievement_grants без изменений; после 0042; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0043_achievements_seasonal')).toBe(
      ids.indexOf('0042_profile_report_reasons') + 1,
    );
    const name = ACHIEVEMENTS_COLLECTIONS.seasonGrants;
    expect(await h.db.listCollections({ name }, { nameOnly: true }).toArray()).toHaveLength(1);
    const seasonIndexes = {
      [ACHIEVEMENT_SEASON_INDEXES.userCodeSeasonUnique.options.name]: {
        key: { userId: 1, code: 1, seasonId: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(name)).toEqual(seasonIndexes);
    const grantIndexes = {
      [ACHIEVEMENTS_INDEXES.grantsUserCodeUnique.options.name]: {
        key: { userId: 1, code: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(ACHIEVEMENTS_COLLECTIONS.grants)).toEqual(grantIndexes);

    // одна выдача на (пользователь, код, сезон); тот же код другого сезона — вставляется
    const grants = h.db.collection<Record<string, unknown> & { _id: string }>(name);
    try {
      await grants.insertOne({
        _id: 's-1',
        userId: 'u-0043',
        code: 'season_podium',
        seasonId: 'a',
      });
      await expect(
        grants.insertOne({ _id: 's-2', userId: 'u-0043', code: 'season_podium', seasonId: 'a' }),
      ).rejects.toThrow(/duplicate key/);
      await grants.insertOne({
        _id: 's-3',
        userId: 'u-0043',
        code: 'season_podium',
        seasonId: 'b',
      });
    } finally {
      await grants.deleteMany({ userId: 'u-0043' });
    }

    await achievementsSeasonal.up(h.db);
    await achievementsSeasonal.up(h.db);
    expect(await indexesOf(name)).toEqual(seasonIndexes);
    expect(await indexesOf(ACHIEVEMENTS_COLLECTIONS.grants)).toEqual(grantIndexes);
  });

  it('0044_route_rides_passed_idx: частичный (updatedAt, _id) по passed рядом с прежним уникальным; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0044_route_rides_passed_idx')).toBe(
      ids.indexOf('0043_achievements_seasonal') + 1,
    );
    const expected = {
      route_rides_user_route_activity_unique: {
        key: { userId: 1, routeId: 1, activityId: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      [ROUTE_RIDES_PASSED_INDEX.options.name]: {
        key: { updatedAt: 1, _id: 1 },
        unique: false,
        partialFilterExpression: { status: 'passed' },
        expireAfterSeconds: undefined,
      },
    };
    expect(ROUTE_RIDES_PASSED_INDEX.options.name).toBe('route_rides_passed_updated_idx');
    expect(await indexesOf(ROUTE_RIDES_COLLECTIONS.rides)).toEqual(expected);
    await routeRidesPassedIdx.up(h.db);
    await routeRidesPassedIdx.up(h.db);
    expect(await indexesOf(ROUTE_RIDES_COLLECTIONS.rides)).toEqual(expected);
  });

  it('0045_social: коллекции и индексы «Свои» и журнала метрик; уникальности; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf('0045_social')).toBe(ids.indexOf('0044_route_rides_passed_idx') + 1);
    const index = (key: Record<string, number>, unique = false) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: undefined,
    });
    const expected = {
      [SOCIAL_COLLECTIONS.connections]: {
        rider_connections_owner_other_unique: index({ ownerId: 1, otherId: 1 }, true),
        rider_connections_other_idx: index({ otherId: 1, ownerId: 1 }),
        rider_connections_ride_idx: index({ 'rides.rideId': 1 }),
      },
      [SOCIAL_COLLECTIONS.attendance]: {
        ride_attendance_user_idx: index({ 'entries.userId': 1 }),
      },
      [SOCIAL_COLLECTIONS.reactions]: {
        social_reactions_unique: index(
          { actorId: 1, kind: 1, targetType: 1, targetId: 1, recipientId: 1 },
          true,
        ),
        social_reactions_target_idx: index({ targetType: 1, targetId: 1, kind: 1 }),
        social_reactions_recipient_idx: index({ recipientId: 1, kind: 1, createdAt: -1 }),
      },
      [SOCIAL_COLLECTIONS.inviteCodes]: {
        invite_codes_code_unique: index({ code: 1 }, true),
      },
      [PRODUCT_EVENTS_COLLECTIONS.events]: {
        product_events_user_idx: index({ userId: 1 }),
        product_events_type_at_idx: index({ type: 1, at: 1 }),
      },
    };
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }

    const connections = h.db.collection<Record<string, unknown> & { _id: string }>(
      SOCIAL_COLLECTIONS.connections,
    );
    const reactions = h.db.collection<Record<string, unknown> & { _id: string }>(
      SOCIAL_COLLECTIONS.reactions,
    );
    try {
      // одна связь на направленную пару; обратная — отдельный документ
      await connections.insertOne({ _id: 'c-0043-1', ownerId: 'u-a', otherId: 'u-b' });
      await expect(
        connections.insertOne({ _id: 'c-0043-2', ownerId: 'u-a', otherId: 'u-b' }),
      ).rejects.toThrow(/duplicate key/);
      await connections.insertOne({ _id: 'c-0043-3', ownerId: 'u-b', otherId: 'u-a' });

      // реакция уникальна с получателем (RC-1): «спасибо» разным получателям в одном райде — можно
      const thanks = (id: string, recipientId: string) => ({
        _id: id,
        kind: 'thanks',
        actorId: 'u-a',
        targetType: 'ride_rider',
        targetId: 'ride-0043',
        recipientId,
      });
      await reactions.insertOne(thanks('r-0043-1', 'u-b'));
      await reactions.insertOne(thanks('r-0043-2', 'u-c'));
      await expect(reactions.insertOne(thanks('r-0043-3', 'u-b'))).rejects.toThrow(/duplicate key/);
    } finally {
      await connections.deleteMany({ _id: /^c-0043-/ });
      await reactions.deleteMany({ _id: /^r-0043-/ });
    }

    await social.up(h.db);
    await social.up(h.db);
    for (const [name, indexes] of Object.entries(expected)) {
      expect(await indexesOf(name)).toEqual(indexes);
    }
  });

  it('0046_ride_photos: коллекция и индексы фото райда; последняя; одно фото на райд; повторный up — без изменений', async () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids.at(-1)).toBe('0046_ride_photos');
    expect(ids.indexOf('0046_ride_photos')).toBe(ids.indexOf('0045_social') + 1);
    const expected = {
      ride_photos_ride_unique: {
        key: { rideId: 1 },
        unique: true,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
      ride_photos_organizer_idx: {
        key: { organizerUserId: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: undefined,
      },
    };
    expect(await indexesOf(RIDE_PHOTOS_COLLECTIONS.photos)).toEqual(expected);
    const photos = h.db.collection<Record<string, unknown> & { _id: string }>(
      RIDE_PHOTOS_COLLECTIONS.photos,
    );
    try {
      await photos.insertOne({ _id: 'p-0046-1', rideId: 'ride-0046', organizerUserId: 'u-a' });
      await expect(
        photos.insertOne({ _id: 'p-0046-2', rideId: 'ride-0046', organizerUserId: 'u-a' }),
      ).rejects.toThrow(/duplicate key/);
    } finally {
      await photos.deleteMany({ _id: /^p-0046-/ });
    }
    await ridePhotos.up(h.db);
    await ridePhotos.up(h.db);
    expect(await indexesOf(RIDE_PHOTOS_COLLECTIONS.photos)).toEqual(expected);
  });
});
