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
];
