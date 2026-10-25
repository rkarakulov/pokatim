import { describe, expect, it } from 'vitest';

import { PANEL_ROLES, PanelRole, Permission, PERMISSIONS } from './permissions.schema.ts';

describe('PanelRole и Permission', () => {
  it('значения — в установленном порядке; новые только добавляются в конец (R6)', () => {
    expect(PANEL_ROLES).toEqual(['admin', 'moderator', 'organizer']);
    expect(PERMISSIONS).toEqual(['members.read', 'members.manage', 'audit.read']);
  });

  it('неизвестные роль и право — ошибка', () => {
    expect(PanelRole.safeParse('owner').success).toBe(false);
    expect(PanelRole.safeParse({ $ne: null }).success).toBe(false);
    expect(Permission.safeParse('races.manage').success).toBe(false);
    expect(Permission.parse('audit.read')).toBe('audit.read');
  });
});
