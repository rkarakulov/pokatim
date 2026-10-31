import { type PanelRole, type Permission, PERMISSIONS } from '@pokatim/contracts';

/**
 * Карта «роль → права» (кандидат в `admin-kit`, F6): `Record` по всем ролям — пропущенная роль — ошибка typecheck.
 * Множества только для чтения; карта заморожена.
 */
export function defineRoles<R extends string, P extends string>(
  map: Record<R, readonly P[]>,
): Readonly<Record<R, ReadonlySet<P>>> {
  const roles = {} as Record<R, ReadonlySet<P>>;
  for (const role of Object.keys(map) as R[]) roles[role] = new Set(map[role]);
  return Object.freeze(roles);
}

/**
 * Права ролей панели — только на сервере. admin-01 (Q2, Q3, Q12): admin — всё; moderator — журнал. admin-02 (§7,
 * Q2, Q13): moderator — чтение «Гонок» и «Сезонов»; organizer — свои гонки (создать, править, опубликовать,
 * отменить); чужие гонки (`races.manage_any`), сезоны и календарь — только admin. 05b: модерация райдов
 * (`rides.moderate`) — admin и moderator. race-results-06 (R1, `[ASSUMPTION]`): споры (`disputes.read`,
 * `disputes.decide`) — admin и moderator (работа команды платформы); organizer — нет. profile-02: сброс публичного
 * имени райдера (`profiles.moderate`) — admin и moderator. app-themes: `appearance.manage` — только admin.
 * race-results-07: пол и год анкеты Verified (`profiles.verified_edit`) — только admin. routes-06: модерация маршрутов
 * райдеров (`routes.moderate`) — admin и moderator. admin-overview: KPI и зависшие удаления на «Обзоре»
 * (`platform.stats`) — только admin. event-tickets: check-in (`tickets.checkin`) — admin и organizer. achievements-panel: ручные решения по достижениям
 * (`achievements.manage`) — только admin. Клиент получает итог в `PanelMe`.
 */
export const ROLE_PERMISSIONS = defineRoles<PanelRole, Permission>({
  admin: PERMISSIONS,
  moderator: [
    'audit.read',
    'races.read',
    'rides.moderate',
    'disputes.read',
    'disputes.decide',
    'profiles.moderate',
    'routes.moderate',
  ],
  // race-results-05 (R1): исключение треков и публикация — организатор (свои гонки); пересчёт после — только admin
  // event-tickets: check-in участников своих гонок
  organizer: ['races.read', 'races.manage', 'results.manage', 'tickets.checkin'],
});

/** Права роли в порядке контракта. */
export function permissionsOf(role: PanelRole): Permission[] {
  return PERMISSIONS.filter((permission) => ROLE_PERMISSIONS[role].has(permission));
}
