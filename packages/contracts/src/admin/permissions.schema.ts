import { z } from 'zod';

/**
 * Роли команды платформы в панели «Протокол» (ADR-0009). Значения только добавляются в конец (R6): SPA и сервер
 * обновляются одним деплоем, но порядок — общий контракт. Карта «роль → права» — только на сервере; клиент получает
 * итоговый список прав в `PanelMe`.
 */
export const PANEL_ROLES = ['admin', 'moderator', 'organizer'] as const;
export const PanelRole = z.enum(PANEL_ROLES);
export type PanelRole = z.infer<typeof PanelRole>;

/** Права панели: проверяет сервер на каждом запросе, клиент только скрывает недоступное. Только в конец (R6). */
export const PERMISSIONS = ['members.read', 'members.manage', 'audit.read'] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;
