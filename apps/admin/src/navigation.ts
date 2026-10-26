import type { Permission } from '@pokatim/contracts';
import type { MessageKey } from '@pokatim/i18n';

export interface NavItem {
  /** Путь раздела внутри `basepath` (маршруты — `router.tsx`). */
  to:
    | '/'
    | '/races'
    | '/calendar'
    | '/seasons'
    | '/members'
    | '/audit'
    | '/rides-moderation'
    | '/disputes';
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
  // 06: сразу после «Гонок» (8.1 RC-18)
  { to: '/disputes', labelKey: 'admin.nav.disputes', permission: 'disputes.read', group: 'main' },
  { to: '/calendar', labelKey: 'admin.nav.calendar', permission: 'calendar.manage', group: 'main' },
  // «Сезоны» — последним в основной группе (прототип 3c)
  { to: '/seasons', labelKey: 'admin.nav.seasons', permission: 'races.read', group: 'main' },
  { to: '/members', labelKey: 'admin.nav.members', permission: 'members.read', group: 'bottom' },
  { to: '/audit', labelKey: 'admin.nav.audit', permission: 'audit.read', group: 'bottom' },
  // 05b: в конец массива, группа `bottom` («Сезоны» остаются последними в основной группе, 8.1 A8)
  {
    to: '/rides-moderation',
    labelKey: 'admin.nav.ridesModeration',
    permission: 'rides.moderate',
    group: 'bottom',
  },
];
