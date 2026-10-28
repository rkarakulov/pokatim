import { Injectable } from '@nestjs/common';
import { type AppThemeId, DEFAULT_APP_THEME_ID } from '@pokatim/contracts';

import type { AppAppearanceSource } from './app-appearance.port';
import { AppearanceRepository } from './appearance.repository';

/** Реализация порта `APP_APPEARANCE`: активная тема из документа настройки платформы. */
@Injectable()
export class AppAppearanceService implements AppAppearanceSource {
  constructor(private readonly repository: AppearanceRepository) {}

  async activeThemeId(): Promise<AppThemeId> {
    return (await this.repository.find())?.themeId ?? DEFAULT_APP_THEME_ID;
  }
}
