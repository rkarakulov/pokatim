import type { RideReason } from '@pokatim/contracts';

/** Коллекции профиля (MongoDB, ADR-0007). Создаёт миграция `0004_profile`; индексов сверх `_id` нет. */
export const PROFILE_COLLECTIONS = { profiles: 'profiles' } as const;

/**
 * Профиль райдера — ПДн отдельно от учётки identity (`pokatim-db.md`): анонимизация при удалении аккаунта —
 * удалить документ. `_id` — id пользователя (один документ на аккаунт). Единственный писатель —
 * `ProfileRepository`.
 */
export interface ProfileDoc {
  _id: string;
  /** Ответ опроса «Что вас привело?» — коды enum контракта (`[]`, пока опрос не пройден). */
  rideReasons: RideReason[];
  /** Время первого ответа (`CLOCK`); `null` — опрос не пройден (документ создал шаг устройств). */
  surveyCompletedAt: Date | null;
  /**
   * Шаг онбординга «Подключите устройство» пройден (флаг аккаунта, R12 tracks-devices); `null`/нет поля — нет.
   * Документы до tracks-devices поля не имеют — чтение `?? null`.
   */
  devicesStepCompletedAt?: Date | null;
  /**
   * «Как вас показывать в результатах» (profile-rider-name, P2): 2–80 символов после zod; `null`/нет поля — не задано.
   * Документы до этого слайса поля не имеют — чтение `?? null`.
   */
  publicName?: string | null;
  /** Согласие на показ имени в таблицах результатов (P1, opt-in); нет поля — `false`. */
  showNameInResults?: boolean;
  /** Время последней записи (`CLOCK`). */
  updatedAt: Date;
}
