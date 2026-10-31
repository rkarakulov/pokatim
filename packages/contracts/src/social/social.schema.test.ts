import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../common.ts';
import {
  ATTENDANCE_VIA,
  AttendanceVia,
  CONNECTION_SOURCES,
  ConnectionSource,
  REACTION_KINDS,
  REACTION_TARGET_TYPES,
  ReactionKind,
  ReactionTargetType,
  RIDE_JOIN_SOURCES,
  RideJoinSource,
  SOCIAL_BLOCK_REASONS,
  SocialActionBlockedDetails,
  SocialBlockReason,
} from './social.schema.ts';

describe('«Свои» (social, ADR-0027): справочники', () => {
  it('состав и порядок — только добавление в конец', () => {
    expect(CONNECTION_SOURCES).toEqual(['ride', 'invite', 'manual']);
    expect(REACTION_KINDS).toEqual(['thanks', 'respect']);
    expect(REACTION_TARGET_TYPES).toEqual(['ride_rider', 'race_entry', 'route']);
    expect(ATTENDANCE_VIA).toEqual(['manual', 'track']);
    expect(RIDE_JOIN_SOURCES).toEqual(['ride_card', 'social_home', 'notification', 'profile']);
    expect(SOCIAL_BLOCK_REASONS).toEqual([
      'self',
      'not_participant',
      'attendance_window',
      'ride_unavailable',
      'not_attended',
    ]);
  });

  it('строгие схемы запросов отвергают незнакомое значение', () => {
    expect(ConnectionSource.parse('invite')).toBe('invite');
    expect(ReactionKind.safeParse('like').success).toBe(false);
    expect(ReactionTargetType.safeParse('ride').success).toBe(false);
    expect(AttendanceVia.safeParse('gps').success).toBe(false);
    expect(RideJoinSource.safeParse('feed').success).toBe(false);
    expect(SocialBlockReason.safeParse('other').success).toBe(false);
  });

  it('details 409 SOCIAL_ACTION_BLOCKED терпят новую причину (unknown)', () => {
    expect(SocialActionBlockedDetails.parse({ reason: 'self' })).toEqual({ reason: 'self' });
    expect(SocialActionBlockedDetails.parse({ reason: 'later' })).toEqual({ reason: 'unknown' });
    // порядок всего списка — common.test.ts (новые коды — после него)
    expect(ErrorCode.options).toContain('SOCIAL_ACTION_BLOCKED');
  });
});
