import type { RiderGender } from '@pokatim/contracts';

import type { DbSession } from '../../db';

/**
 * Порт `profile` для модуля `results` (race-results-07, через `modules/profile/index.ts`): пол и год анкеты Verified
 * — для группы зачёта. `results` коллекцию анкет не читает и не пишет; вес, рост и FTP через порт не выходят.
 */
export const VERIFIED_PROFILES = Symbol('VERIFIED_PROFILES');

export interface VerifiedDemographics {
  gender: RiderGender;
  birthYear: number;
}

export interface VerifiedProfiles {
  /** Пол и год анкеты (чтение «моего участия»); анкеты нет — `null`. */
  demographicsOf(userId: string): Promise<VerifiedDemographics | null>;
  /**
   * Фиксация пола и года в транзакции Verified-заявки: запись документа анкеты (`demographicsLockedAt ??= now`) —
   * конфликт с одновременной правкой анкеты. Анкеты нет — `null`.
   */
  lockForEntry(tx: DbSession, userId: string, now: Date): Promise<VerifiedDemographics | null>;
}
