import { Injectable } from '@nestjs/common';
import { type AppThemeId, DEFAULT_APP_THEME_ID } from '@pokatim/contracts';

import { ProfileRepository } from './profile.repository';
import type { RiderThemes } from './rider-themes.port';

/** Реализация порта `RiderThemes`: читает `profiles` только через `ProfileRepository`. */
@Injectable()
export class RiderThemesService implements RiderThemes {
  constructor(private readonly repository: ProfileRepository) {}

  async themeOf(userId: string): Promise<AppThemeId> {
    return (await this.repository.findTheme(userId)) ?? DEFAULT_APP_THEME_ID;
  }
}
