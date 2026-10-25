import type { Permission } from '@pokatim/contracts';
import type { MessageKey } from '@pokatim/i18n';

export interface NavItem {
  /** Путь раздела внутри `basepath` (маршруты — `router.tsx`). */
  to: '/' | '/races' | '/calendar' | '/seasons' | '/members' | '/audit';
  labelKey: MessageKey;
  /** Без права пункт скрыт (сервер всё равно проверит право на каждом запросе). */
  permission?: Permission;
  /** `bottom` — служебная группа внизу сайдбара над блоком сотрудника. */
  group: 'main' | 'bottom';
}

/**
 * Навигация панели — один файл (R10): разделы следующих слайсов (Приложение A) добавляются сюда с правом.
 */
export const NAVIGATION: readonly NavItem[] = [
  { to: '/', labelKey: 'admin.nav.overview', group: 'main' },
  { to: '/races', labelKey: 'admin.nav.races', permission: 'races.read', group: 'main' },
  { to: '/calendar', labelKey: 'admin.nav.calendar', permission: 'calendar.manage', group: 'main' },
  // «Сезоны» — последним в основной группе (прототип 3c)
  { to: '/seasons', labelKey: 'admin.nav.seasons', permission: 'races.read', group: 'main' },
  { to: '/members', labelKey: 'admin.nav.members', permission: 'members.read', group: 'bottom' },
  { to: '/audit', labelKey: 'admin.nav.audit', permission: 'audit.read', group: 'bottom' },
];
