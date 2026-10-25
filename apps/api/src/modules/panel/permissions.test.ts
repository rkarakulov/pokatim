import { PANEL_ROLES, PERMISSIONS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { defineRoles, permissionsOf, ROLE_PERMISSIONS } from './permissions';

describe('карта ролей панели (Q2, Q3, Q12)', () => {
  it('полна по PanelRole', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...PANEL_ROLES].sort());
  });

  it('admin — все права; moderator — только журнал; organizer — ничего', () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...PERMISSIONS].sort());
    expect([...ROLE_PERMISSIONS.moderator]).toEqual(['audit.read']);
    expect(ROLE_PERMISSIONS.organizer.size).toBe(0);
  });

  it('permissionsOf — в порядке контракта (стабильный ответ PanelMe)', () => {
    expect(permissionsOf('admin')).toEqual([...PERMISSIONS]);
    expect(permissionsOf('moderator')).toEqual(['audit.read']);
    expect(permissionsOf('organizer')).toEqual([]);
  });

  it('defineRoles: множества неизменяемы для вызывающего и без дублей', () => {
    const roles = defineRoles<'a' | 'b', 'x' | 'y'>({ a: ['x', 'x', 'y'], b: [] });
    expect([...roles.a]).toEqual(['x', 'y']);
    expect(roles.b.size).toBe(0);
    expect(Object.isFrozen(roles)).toBe(true);
  });
});
