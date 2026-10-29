import type { AppDecorId, AppThemeId } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Настройки платформы (app-themes): документы-синглтоны по `_id`. Создаёт миграция `0024_platform_settings`.
 * Единственный писатель документа `appearance` — `AppearanceRepository`; другие документы `platform_settings` —
 * только своими `_id` и своими репозиториями.
 */
export const APPEARANCE_COLLECTIONS = { settings: 'platform_settings' } as const;

/** `_id` документа оформления приложения. */
export const APPEARANCE_SETTINGS_ID = 'appearance' as const;

/**
 * Оформление приложения — глобальная настройка: сезонный декор. Нет документа — без декора, `version: 0`. Кто менял —
 * только журнал панели (без `userId` в документе: стирание аккаунта его не касается).
 */
export interface AppearanceSettingsDoc {
  _id: typeof APPEARANCE_SETTINGS_ID;
  /**
   * Legacy (app-themes, T1): глобальная тема до user-theme (ADR-0021) — не читается и не пишется, новые документы
   * поля не имеют; в существующем документе остаётся без миграции.
   */
  themeId?: AppThemeId;
  /** halloween-decor: сезонный декор; нет поля (документ до декора, менялась только тема) — `none`. */
  decor?: AppDecorId;
  version: number;
  updatedAt: Date;
}

export function appearanceCollections(db: Db): { settings: Collection<AppearanceSettingsDoc> } {
  return { settings: db.collection<AppearanceSettingsDoc>(APPEARANCE_COLLECTIONS.settings) };
}
