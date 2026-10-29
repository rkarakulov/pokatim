import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { outbox } from './0001_outbox';
import { identity } from './0002_identity';
import { identityTtl } from './0003_identity_ttl';
import { profile } from './0004_profile';
import { panel } from './0005_panel';
import { panelAuditSubject } from './0006_panel_audit_subject';
import { races } from './0007_races';
import { calendar } from './0008_calendar';
import { racesSeasonPublicIdx } from './0009_races_season_public_idx';
import { tracks } from './0010_tracks';
import { devices } from './0011_devices';
import { trackSourceRefs } from './0012_track_source_refs';
import { routes } from './0013_routes';
import { rides } from './0014_rides';
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
import { notifications } from './0025_notifications';
import { attemptLastVerdict } from './0026_attempt_last_verdict';
import { pushTicketsUser } from './0027_push_tickets_user';
import { entryTier } from './0028_entry_tier';
import { routesPublication } from './0029_routes_publication';
import { standings } from './0030_standings';
import { ridesGeo } from './0031_rides_geo';
import { routeRides } from './0032_route_rides';
import { riderProfile } from './0033_rider_profile';
import { profileReports } from './0034_profile_reports';
import { achievements } from './0035_achievements';
import { overviewIndexes } from './0036_overview_indexes';
import { ogSyncIndexes } from './0037_og_sync_indexes';
import { tickets } from './0038_tickets';
import { eventMaterials } from './0039_event_materials';
import { panelTotp } from './0040_panel_totp';

/**
 * Миграции MongoDB по порядку (`db:migrate`, `.claude/rules/db.md`): новая — в конец списка, применённые не
 * меняются. Стенд тестов прогоняет этот же список на чистой `*_test`.
 */
export const migrations: readonly MongoMigration[] = [
  outbox,
  identity,
  identityTtl,
  profile,
  panel,
  panelAuditSubject,
  races,
  calendar,
  racesSeasonPublicIdx,
  tracks,
  devices,
  trackSourceRefs,
  routes,
  rides,
  results,
  protocol,
  rideReports,
  disputes,
  profileConsents,
  routesCatalog,
  routesRider,
  routesDerived,
  accountDeletion,
  platformSettings,
  notifications,
  attemptLastVerdict,
  pushTicketsUser,
  entryTier,
  routesPublication,
  standings,
  ridesGeo,
  routeRides,
  riderProfile,
  profileReports,
  achievements,
  overviewIndexes,
  ogSyncIndexes,
  tickets,
  eventMaterials,
  panelTotp,
];
