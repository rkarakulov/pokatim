import type { AppThemeId } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Настройки платформы (app-themes): документы-синглтоны по `_id`. Создаёт миграция `0024_platform_settings`.
 * Единственный писатель документа `appearance` — `AppearanceRepository`; другие документы `platform_settings` —
 * только своими `_id` и своими репозиториями.
 */
export const APPEARANCE_COLLECTIONS = { settings: 'platform_settings' } as const;

/** `_id` документа темы приложения. */
export const APPEARANCE_SETTINGS_ID = 'appearance' as const;

/**
 * Тема приложения — глобальная настройка (T1). Нет документа — «Классика», `version: 0`. Кто менял — только журнал
 * панели (без `userId` в документе: стирание аккаунта его не касается).
 */
export interface AppearanceSettingsDoc {
  _id: typeof APPEARANCE_SETTINGS_ID;
  themeId: AppThemeId;
  version: number;
  updatedAt: Date;
}

export function appearanceCollections(db: Db): { settings: Collection<AppearanceSettingsDoc> } {
  return { settings: db.collection<AppearanceSettingsDoc>(APPEARANCE_COLLECTIONS.settings) };
}
