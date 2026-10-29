import type { Permission } from '@pokatim/contracts';
import type { MessageKey } from '@pokatim/i18n';
import type { LinkProps } from '@tanstack/react-router';

import { MODERATION_TABS } from './features/moderation/moderation-tabs';

export interface NavItem {
  /** Путь раздела внутри `basepath` (маршруты — `router.tsx`). */
  to:
    | '/'
    | '/races'
    | '/calendar'
    | '/check-in'
    | '/routes'
    | '/seasons'
    | '/members'
    | '/audit'
    | '/moderation'
    | '/disputes'
    | '/appearance';
  labelKey: MessageKey;
  /** Без права пункт скрыт (сервер всё равно проверит право на каждом запросе). */
  permission?: Permission;
  /** Пункт-раздел нескольких очередей: виден при любом из прав (вместо `permission`). */
  anyPermission?: readonly Permission[];
  /** Пути, на которых (и на вложенных) пункт подсвечен, — когда сам `to` только перенаправляет. */
  sections?: readonly NonNullable<LinkProps['to']>[];
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
  // event-tickets PR C: после «Календаря» — экран без сайдбара (телефон организатора на старте)
  {
    to: '/check-in',
    labelKey: 'admin.nav.checkIn',
    permission: 'tickets.checkin',
    group: 'main',
  },
  // routes-01: после «Календаря», до «Сезонов»
  { to: '/routes', labelKey: 'admin.nav.routes', permission: 'races.read', group: 'main' },
  // «Сезоны» — последним в основной группе (прототип 3c)
  { to: '/seasons', labelKey: 'admin.nav.seasons', permission: 'races.read', group: 'main' },
  { to: '/members', labelKey: 'admin.nav.members', permission: 'members.read', group: 'bottom' },
  { to: '/audit', labelKey: 'admin.nav.audit', permission: 'audit.read', group: 'bottom' },
  // admin-moderation-hub: три очереди модерации — один пункт с вкладками (`features/moderation`), на месте
  // «Модерации райдов» (05b); вкладки — маршруты райдеров (routes-06), профили (profile-moderation), кофе-райды
  {
    to: '/moderation',
    labelKey: 'admin.nav.moderation',
    anyPermission: MODERATION_TABS.map((tab) => tab.permission),
    sections: MODERATION_TABS.map((tab) => tab.to),
    group: 'bottom',
  },
  // app-themes D1: группа `bottom`, после «Модерации»
  {
    to: '/appearance',
    labelKey: 'admin.nav.appearance',
    permission: 'appearance.manage',
    group: 'bottom',
  },
];

/** Пункт виден сотруднику (только отображение): нет требований, есть право или любое из прав раздела. */
export function isNavItemVisible(item: NavItem, permissions: readonly Permission[]): boolean {
  if (item.permission) return permissions.includes(item.permission);
  if (item.anyPermission) return item.anyPermission.some((value) => permissions.includes(value));
  return true;
}
