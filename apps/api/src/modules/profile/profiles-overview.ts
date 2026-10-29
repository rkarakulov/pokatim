import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';

/**
 * Порт `profile` для «Обзора» панели (admin-overview, модуль `overview`): профили с открытыми жалобами — элементы
 * очереди «Профилей райдеров». Только чтение.
 */
@Injectable()
export class ProfilesOverview {
  constructor(private readonly repository: ProfileRepository) {}

  reportedCount(): Promise<number> {
    return this.repository.countReportQueue();
  }
}
