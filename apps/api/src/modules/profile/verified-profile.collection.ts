import type { RiderGender } from '@pokatim/contracts';

/**
 * Анкета зачёта Verified (race-results-07), коллекция `rider_verified_profiles` (`PROFILE_COLLECTIONS.verified`,
 * миграция `0028_entry_tier`, индексов сверх `_id` нет). `_id` — id пользователя. Единственный писатель —
 * `VerifiedProfileRepository`. Значения — ПДн и антропометрия: не в логах, outbox, журнале панели; вес, рост и FTP —
 * только владельцу. Удаление аккаунта — `ProfileErasure` удаляет документ.
 */
export interface RiderVerifiedProfileDoc {
  _id: string;
  gender: RiderGender;
  birthYear: number;
  weightKg: number;
  heightCm: number;
  ftpW: number | null;
  /** время последнего согласия (каждый `PUT` несёт `consent: true`) */
  consentAt: Date;
  /** `VERIFIED_PROFILE_CONSENT_VERSION` контракта на момент согласия */
  consentVersion: string;
  /**
   * Пол и год зафиксированы первой Verified-заявкой (в её транзакции, `lockForEntry`); после — правит только admin
   * панели. `null` — Verified-заявок не было.
   */
  demographicsLockedAt: Date | null;
  updatedAt: Date;
  /** счётчик записей: каждая запись документа (`PUT`, панель, заявка Verified) — `$inc` */
  version: number;
}
