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
  /** Ответ опроса «Что вас привело?» — коды enum контракта. */
  rideReasons: RideReason[];
  /** Время первого ответа (`CLOCK`). */
  surveyCompletedAt: Date;
  /** Время последнего ответа (`CLOCK`). */
  updatedAt: Date;
}
