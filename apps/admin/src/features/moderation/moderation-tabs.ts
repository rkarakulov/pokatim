import type { PanelOverview, Permission } from '@pokatim/contracts';
import type { MessageKey } from '@pokatim/i18n';

export interface ModerationTab {
  /** Существующий адрес очереди (закладки и ссылки «Обзора» не меняются). */
  to: '/rider-routes' | '/rider-profiles' | '/rides-moderation';
  labelKey: MessageKey;
  permission: Permission;
  /** Ждут решения — из «Обзора» (те же очереди, что в разделах); поля нет — без счётчика. */
  count: (attention: PanelOverview['attention']) => number | undefined;
}

/**
 * Раздел «Модерация» (admin-moderation-hub): вкладки по типу контента. Порядок — и порядок вкладок, и выбор первой
 * доступной для `/moderation`: премодерация заявок в каталог первой.
 */
export const MODERATION_TABS: readonly ModerationTab[] = [
  {
    to: '/rider-routes',
    labelKey: 'admin.moderation.tab.riderRoutes',
    permission: 'routes.moderate',
    count: ({ riderRoutes }) => riderRoutes && riderRoutes.pending + riderRoutes.reported,
  },
  {
    to: '/rider-profiles',
    labelKey: 'admin.moderation.tab.riderProfiles',
    permission: 'profiles.moderate',
    count: ({ riderProfiles }) => riderProfiles?.reported,
  },
  {
    to: '/rides-moderation',
    labelKey: 'admin.moderation.tab.rides',
    permission: 'rides.moderate',
    count: ({ rides }) => rides?.reported,
  },
];

/** Вкладки, доступные по правам сотрудника (только отображение; сервер проверит право на каждом запросе). */
export const allowedModerationTabs = (permissions: readonly Permission[]) =>
  MODERATION_TABS.filter((tab) => permissions.includes(tab.permission));
