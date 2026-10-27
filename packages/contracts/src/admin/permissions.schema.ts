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
export const PERMISSIONS = [
  'members.read',
  'members.manage',
  'audit.read',
  // admin-02: гонки (свои; чужие — `races.manage_any`), сезоны, календарь стартов
  'races.read',
  'races.manage',
  'races.manage_any',
  'seasons.manage',
  'calendar.manage',
  // race-results-05: протокол гонки — исключение треков и публикация; экстренный пересчёт после публикации
  'results.manage',
  'results.revise',
  // 05b: модерация кофе-райдов по жалобам
  'rides.moderate',
  // race-results-06: споры по результатам — просмотр и решение (команда платформы)
  'disputes.read',
  'disputes.decide',
  // profile-02: сброс публичного имени райдера (команда платформы)
  'profiles.moderate',
  // app-themes: тема приложения райдера (только admin)
  'appearance.manage',
  // routes-06: модерация маршрутов райдеров (заявки в каталог и жалобы) — admin и moderator
  'routes.moderate',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;
