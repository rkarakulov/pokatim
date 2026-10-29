import { Injectable } from '@nestjs/common';

import { DisputesRepository } from './disputes.repository';

/**
 * Порт `disputes` для «Обзора» панели (admin-overview, модуль `overview`): открытые споры — та же очередь, что
 * «Споры» (`status: 'open'`). Только чтение.
 */
@Injectable()
export class DisputesOverview {
  constructor(private readonly repository: DisputesRepository) {}

  openCount(): Promise<number> {
    return this.repository.countOpen();
  }
}
