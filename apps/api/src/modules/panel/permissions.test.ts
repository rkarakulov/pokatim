import { PANEL_ROLES, PERMISSIONS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { defineRoles, permissionsOf, ROLE_PERMISSIONS } from './permissions';

describe('карта ролей панели (admin-01 Q2, Q3, Q12; admin-02 §7)', () => {
  it('полна по PanelRole', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...PANEL_ROLES].sort());
  });

  it('admin — все права; moderator — журнал и чтение гонок/сезонов; organizer — свои гонки', () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...PERMISSIONS].sort());
    expect([...ROLE_PERMISSIONS.moderator].sort()).toEqual([
      'audit.read',
      'disputes.decide',
      'disputes.read',
      'profiles.moderate',
      'races.read',
      'rides.moderate',
    ]);
    expect([...ROLE_PERMISSIONS.organizer].sort()).toEqual([
      'races.manage',
      'races.read',
      'results.manage',
    ]);
  });

  it('матрица §7: manage_any, seasons.manage, calendar.manage — только admin', () => {
    for (const permission of ['races.manage_any', 'seasons.manage', 'calendar.manage'] as const) {
      expect(ROLE_PERMISSIONS.admin.has(permission)).toBe(true);
      expect(ROLE_PERMISSIONS.moderator.has(permission)).toBe(false);
      expect(ROLE_PERMISSIONS.organizer.has(permission)).toBe(false);
    }
    expect(ROLE_PERMISSIONS.moderator.has('races.manage')).toBe(false);
  });

  it('протокол (race-results-05, R1): results.manage — admin и organizer; results.revise — только admin', () => {
    expect(ROLE_PERMISSIONS.admin.has('results.manage')).toBe(true);
    expect(ROLE_PERMISSIONS.admin.has('results.revise')).toBe(true);
    expect(ROLE_PERMISSIONS.organizer.has('results.manage')).toBe(true);
    expect(ROLE_PERMISSIONS.organizer.has('results.revise')).toBe(false);
    expect(ROLE_PERMISSIONS.moderator.has('results.manage')).toBe(false);
    expect(ROLE_PERMISSIONS.moderator.has('results.revise')).toBe(false);
  });

  it('05b: модерация райдов — admin и moderator, не organizer', () => {
    expect(ROLE_PERMISSIONS.admin.has('rides.moderate')).toBe(true);
    expect(ROLE_PERMISSIONS.moderator.has('rides.moderate')).toBe(true);
    expect(ROLE_PERMISSIONS.organizer.has('rides.moderate')).toBe(false);
  });

  it('race-results-06 (R1): споры — admin и moderator, не organizer', () => {
    for (const permission of ['disputes.read', 'disputes.decide'] as const) {
      expect(ROLE_PERMISSIONS.admin.has(permission)).toBe(true);
      expect(ROLE_PERMISSIONS.moderator.has(permission)).toBe(true);
      expect(ROLE_PERMISSIONS.organizer.has(permission)).toBe(false);
    }
  });

  it('profile-02: сброс имени райдера — admin и moderator, не organizer', () => {
    expect(ROLE_PERMISSIONS.admin.has('profiles.moderate')).toBe(true);
    expect(ROLE_PERMISSIONS.moderator.has('profiles.moderate')).toBe(true);
    expect(ROLE_PERMISSIONS.organizer.has('profiles.moderate')).toBe(false);
  });

  it('permissionsOf — в порядке контракта (стабильный ответ PanelMe)', () => {
    expect(permissionsOf('admin')).toEqual([...PERMISSIONS]);
    expect(permissionsOf('moderator')).toEqual([
      'audit.read',
      'races.read',
      'rides.moderate',
      'disputes.read',
      'disputes.decide',
      'profiles.moderate',
    ]);
    expect(permissionsOf('organizer')).toEqual(['races.read', 'races.manage', 'results.manage']);
  });

  it('defineRoles: множества неизменяемы для вызывающего и без дублей', () => {
    const roles = defineRoles<'a' | 'b', 'x' | 'y'>({ a: ['x', 'x', 'y'], b: [] });
    expect([...roles.a]).toEqual(['x', 'y']);
    expect(roles.b.size).toBe(0);
    expect(Object.isFrozen(roles)).toBe(true);
  });
});
