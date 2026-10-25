import type { Collection, Db } from 'mongodb';

/**
 * Коллекции identity (MongoDB, ADR-0007). Поля — camelCase, `_id` — строка UUID v7 (`uuidv7()` до вставки: от id
 * выводится токен ссылки и `sid`), время — BSON `Date` из `CLOCK`, nullable-поля пишутся явным `null` (фильтр
 * `{ x: null }` и частичные индексы `{ $eq: null }` совпадают). Индексы — только миграцией `0002_identity`.
 * Ограничений БД (CHECK, FK) нет: инварианты держит единственный писатель — `IdentityRepository` (R5), каскад
 * удаления — явный (R4).
 */
export const IDENTITY_COLLECTIONS = {
  users: 'users',
  userConsents: 'user_consents',
  emailVerificationTokens: 'email_verification_tokens',
  passwordResetTokens: 'password_reset_tokens',
  registrationTokens: 'registration_tokens',
  sessions: 'sessions',
} as const;

/**
 * Аккаунт райдера. E-mail хранится нормализованным (lower); уникальность — полная, включая удалённые аккаунты:
 * адрес удалённого аккаунта не регистрируется заново (D-07). `version` растёт на каждой транзакции, меняющей
 * документы аккаунта (`lockUser`, R1): две такие транзакции одного аккаунта конфликтуют и идут по очереди.
 */
export interface UserDoc {
  _id: string;
  email: string;
  passwordHash: string;
  /** `YYYY-MM-DD` */
  birthDate: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  version: number;
}

export const CONSENT_KINDS = ['personal_data', 'agreement'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Согласия — append-only журнал (что, какой версии, когда принято); удаляются только каскадом очистки (R4). */
export interface UserConsentDoc {
  _id: string;
  userId: string;
  kind: ConsentKind;
  version: string;
  acceptedAt: Date;
}

/**
 * Ссылка из письма: подтверждение e-mail или сброс пароля. Токен ссылки = HMAC(EMAIL_TOKEN_SECRET, id) — в БД только
 * sha256 от него. Активная ссылка у пользователя одна: новая заменяет прежние (`supersededAt`). `sendClaimedAt` —
 * захват отправки письма с ограниченным сроком (упавший worker не блокирует ретрай навсегда), `sentAt` — факт отправки.
 */
export interface LinkTokenDoc {
  _id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  supersededAt: Date | null;
  sentAt: Date | null;
  sendClaimedAt: Date | null;
}

/** Токен регистрации (ADR-0002): только poll и resend, на сессию меняется один раз; у пользователя один. */
export interface RegistrationTokenDoc {
  _id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * Причина отзыва сессии (аудит без журнала входов, слайс 2, R6); `password_reset` — смена пароля по ссылке
 * отзывает все сессии аккаунта (слайс 3).
 */
export const SESSION_REVOKED_REASONS = [
  'signed_out',
  'reuse_detected',
  'superseded',
  'password_reset',
] as const;
export type SessionRevokedReason = (typeof SESSION_REVOKED_REASONS)[number];

/**
 * Сессия: refresh-токен хранится только хешем, `_id` — claim `sid` в access JWT. Ротация (ADR-0005): предыдущий
 * хеш действует ещё окно повтора после `rotatedAt`; позже — reuse detection.
 */
export interface SessionDoc {
  _id: string;
  userId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  rotatedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokedReason | null;
}

export interface IdentityCollections {
  users: Collection<UserDoc>;
  userConsents: Collection<UserConsentDoc>;
  emailVerificationTokens: Collection<LinkTokenDoc>;
  passwordResetTokens: Collection<LinkTokenDoc>;
  registrationTokens: Collection<RegistrationTokenDoc>;
  sessions: Collection<SessionDoc>;
}

/** Типизированные коллекции identity — для репозитория, миграции и int-тестов. */
export function identityCollections(db: Db): IdentityCollections {
  return {
    users: db.collection<UserDoc>(IDENTITY_COLLECTIONS.users),
    userConsents: db.collection<UserConsentDoc>(IDENTITY_COLLECTIONS.userConsents),
    emailVerificationTokens: db.collection<LinkTokenDoc>(
      IDENTITY_COLLECTIONS.emailVerificationTokens,
    ),
    passwordResetTokens: db.collection<LinkTokenDoc>(IDENTITY_COLLECTIONS.passwordResetTokens),
    registrationTokens: db.collection<RegistrationTokenDoc>(
      IDENTITY_COLLECTIONS.registrationTokens,
    ),
    sessions: db.collection<SessionDoc>(IDENTITY_COLLECTIONS.sessions),
  };
}
