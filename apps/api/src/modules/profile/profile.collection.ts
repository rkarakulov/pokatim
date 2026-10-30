import type { AppThemeId, ProfileReportReason, RideReason } from '@pokatim/contracts';
import type { Binary } from 'mongodb';

/**
 * Коллекции профиля (MongoDB, ADR-0007). `profiles` создаёт миграция `0004_profile` (индексов сверх `_id` нет),
 * `profile_consent_events` — `0019_profile_consents` (индекс `{ userId, at }`), `rider_verified_profiles` —
 * `0028_entry_tier` (race-results-07, индексов сверх `_id` нет).
 */
export const PROFILE_COLLECTIONS = {
  profiles: 'profiles',
  consentEvents: 'profile_consent_events',
  verified: 'rider_verified_profiles',
  /** rider-profile: аватары (`0033_rider_profile`, индекс `{ userId }`); единственный писатель — `ProfileAvatarRepository` */
  avatars: 'profile_avatars',
} as const;

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
  /** Клуб (rider-profile): 2–60 символов после zod; `null`/нет поля — не задан. */
  club?: string | null;
  /** Текущий аватар (rider-profile) — `_id` документа `profile_avatars`; `null`/нет поля — нет фото. */
  avatarId?: string | null;
  /**
   * Id публичного профиля (rider-profile, R-3): случайный токен, создаётся при первом «имя + согласие» и больше не
   * меняется (отзыв согласия его не стирает — наружу он не выдаётся). Уникальный частичный индекс (`0033`).
   */
  publicId?: string | null;
  /**
   * Личная тема приложения (user-theme, ADR-0021): id из закрытого списка после zod; `null`/нет поля — «Классика».
   * Необязательное поле без миграции и индекса (по теме не ищут); пишет только `PUT /v1/profile/theme`.
   */
  themeId?: AppThemeId | null;
  /**
   * profile-moderation: число открытых жалоб на профиль (= числу открытых документов жалоб, `resolvedAt: null`;
   * транзакция жалобы и действий модерации — запись профиля первой). Нет поля — 0. Наружу в `ProfileView` и
   * публичный профиль не выходит.
   */
  openReportCount?: number;
  /** profile-moderation: `$inc` каждой жалобой, монотонна — маркер «Отклонить жалобы». Нет поля — 0. */
  reportRevision?: number;
  /** profile-moderation: время последней жалобы (`$max`) — только порядок очереди панели. Нет поля — `null`. */
  lastReportAt?: Date | null;
  /**
   * profile-moderation-followups (RC-F1): причины открытых жалоб (`$addToSet` жалобой, `[]` — каждым действием,
   * закрывающим все открытые). Порядок не держится — сервис упорядочивает по справочнику. Нет поля — `[]` (бэкфилл
   * `0041`). Частичный индекс `profiles_report_reason_queue_idx`.
   */
  openReasons?: ProfileReportReason[];
  /** profile-moderation-followups (RC-F7): сбросы фото модератором в окне правила запрета; нет поля — `[]`. */
  avatarResetsAt?: Date[];
  /** profile-moderation-followups: загрузка фото запрещена до этого момента; нет поля / `null` / прошло — нет запрета. */
  avatarBlockedUntil?: Date | null;
  /**
   * profile-moderation-followups (ревью pass 2): ревизия сбросов модератором — `$inc` условной записью каждого сброса
   * (имя, фото, клуб), монотонна; номер — `seq` события `profile.field-reset` (порядок уведомлений). Нет поля — 0.
   */
  resetSeq?: number;
  /** Время последней записи райдера или модератора (`CLOCK`; жалоба его не трогает). */
  updatedAt: Date;
}

/** Виды согласий журнала (profile-02): пока только показ публичного имени в таблицах результатов. */
export const PROFILE_CONSENT_KINDS = ['public_name'] as const;
/** Действие события согласия: включение или отзыв. */
export const PROFILE_CONSENT_ACTIONS = ['granted', 'revoked'] as const;

/**
 * Событие журнала согласий (profile-02, Q1): append-only — только `insertOne` в `ProfileRepository` (тест-сторож),
 * пишется в транзакции `PATCH /v1/profile` при фактической смене флага. Имени нет (только псевдонимный `userId`);
 * журнал переживает удаление аккаунта как доказательство согласия (D10). Версия текста и время — сервер.
 */
export interface ProfileConsentEventDoc {
  _id: string;
  userId: string;
  kind: (typeof PROFILE_CONSENT_KINDS)[number];
  action: (typeof PROFILE_CONSENT_ACTIONS)[number];
  /** `PUBLIC_NAME_CONSENT_VERSION` контракта на момент события. */
  version: string;
  /** Время события (`CLOCK`). */
  at: Date;
}

/**
 * Аватар райдера (rider-profile, ADR-0019): перекодированный JPEG 512×512 без метаданных (исходник не хранится).
 * `_id` — `randomToken` (непредсказуемый, новый при каждой замене). Единственный писатель —
 * `ProfileAvatarRepository`; один документ на пользователя (замена удаляет прежний в той же транзакции).
 */
export interface ProfileAvatarDoc {
  _id: string;
  userId: string;
  bytes: Binary;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  bytesLength: number;
  createdAt: Date;
}
