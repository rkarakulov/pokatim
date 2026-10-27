import { Injectable } from '@nestjs/common';

import type { DisputeNotices, DisputeParties } from './dispute-notices.port';
import { DisputesRepository } from './disputes.repository';

/** Реализация порта `DisputeNotices` (notifications): проекция сторон спора `DisputesRepository`. */
@Injectable()
export class DisputeNoticesService implements DisputeNotices {
  constructor(private readonly repository: DisputesRepository) {}

  parties(disputeId: string): Promise<DisputeParties | null> {
    return this.repository.findParties(disputeId);
  }
}
