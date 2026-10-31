import type {
  AchievementCode,
  AchievementLevel,
  AchievementObjectKind,
  InvitationEmailState,
  AppDecorId,
  AppThemeId,
  AuditAction,
  AuditSubjectKind,
  MemberStatus,
  PanelRole,
  RaceCancelReason,
  RouteRejectionReason,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции панели «Протокол» (ADR-0009). Создаёт миграция `0005_panel`; единственный писатель — `PanelRepository`.
 * Поля — camelCase, время — BSON `Date` из `CLOCK`, nullable — явным `null`.
 */
export const PANEL_COLLECTIONS = {
  members: 'panel_members',
  sessions: 'panel_sessions',
  audit: 'panel_audit',
  meta: 'panel_meta',
  totp: 'panel_totp',
  challenges: 'panel_sign_in_challenges',
  devices: 'panel_trusted_devices',
  /** Приглашения в команду (ADR-0026, `0041_panel_invitations`); единственный писатель — `PanelInvitationsRepository`. */
  invitations: 'panel_invitations',
} as const;

/**
 * Член команды платформы: `_id` — id пользователя приложения (один документ на аккаунт, как `profiles`). Роль —
 * данные контекста `panel`, не поле `users` (R2). `version` растёт на каждой транзакции, меняющей документ
 * (`lockMember`): две такие транзакции одного члена конфликтуют.
 */
export interface PanelMemberDoc {
  _id: string;
  role: PanelRole;
  status: MemberStatus;
  /** Имя в панели — вводит админ при выдаче роли. */
  displayName: string;
  grantedAt: Date;
  revokedAt: Date | null;
  version: number;
}

export const PANEL_SESSION_REVOKED_REASONS = [
  'signed_out',
  'superseded',
  'role_revoked',
  'credentials_changed',
  'account_inactive',
  /** 2FA сотрудника сброшена администратором или CLI (ADR-0024). */
  'totp_reset',
] as const;
export type PanelSessionRevokedReason = (typeof PANEL_SESSION_REVOKED_REASONS)[number];

/**
 * Сессия панели: непрозрачный токен в cookie, в БД — только sha256 (`tokenHash`). `credentialsStamp` — штамп
 * учётных данных на момент входа: гард сверяет его с текущим (смена пароля гасит сессию). Простой — `idleExpiresAt`,
 * абсолютный срок — `expiresAt`.
 */
export interface PanelSessionDoc {
  _id: string;
  userId: string;
  tokenHash: string;
  credentialsStamp: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: PanelSessionRevokedReason | null;
  /** Второй фактор входа (ADR-0024): нет у сессий до 2FA и у входа без 2FA — `null`/отсутствует. */
  secondFactor?: PanelSecondFactor | null;
}

export type PanelSecondFactor = 'totp' | 'recovery' | 'device';

/** Код восстановления 2FA: только HMAC нормализованного кода; `usedAt` — погашен. */
export interface PanelRecoveryCodeDoc {
  hash: string;
  usedAt: Date | null;
}

/**
 * 2FA сотрудника (ADR-0024): `_id` — userId. `pending` — подключение начато (секрет выдан, кода ещё не было),
 * `active` — подключена. `secretEnc` — AES-256-GCM (`TotpSecretBox`), `lastUsedStep` — последний принятый шаг TOTP
 * (повтор закрыт условным обновлением), `epoch` — uuidv7, новый при каждом подключении (гасит доверенные устройства).
 */
export interface PanelTotpDoc {
  _id: string;
  status: 'pending' | 'active';
  secretEnc: string;
  lastUsedStep: number | null;
  recoveryCodes: PanelRecoveryCodeDoc[];
  enabledAt: Date | null;
  epoch: string;
  updatedAt: Date;
}

/**
 * Вызов второго шага входа (ADR-0024, D7): токен — только sha256, 5 минут, ≤ 5 попыток кода (`attempts`
 * резервируется до проверки); успех удаляет документ атомарно. `purpose: 'setup'` — admin без 2FA при обязательной 2FA.
 */
export interface PanelSignInChallengeDoc {
  _id: string;
  tokenHash: string;
  userId: string;
  credentialsStamp: string;
  purpose: 'totp' | 'setup';
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Доверенное устройство (ADR-0024, D4): пропускает только шаг кода. Годно при совпадении штампа учётных данных и
 * эпохи 2FA и до `expiresAt`; токен — только sha256.
 */
export interface PanelTrustedDeviceDoc {
  _id: string;
  tokenHash: string;
  userId: string;
  credentialsStamp: string;
  totpEpoch: string;
  createdAt: Date;
  expiresAt: Date;
  /** Замок: вход по устройству пишет `$inc version` в своей транзакции — сброс 2FA (удаление) с ним сериализуется. */
  version: number;
}

export type PanelInvitationStatus = 'pending' | 'accepted' | 'revoked';

/**
 * Приглашение в команду (ADR-0026): токен ссылки — `HMAC(EMAIL_TOKEN_SECRET, "panel-invitation:" + _id)`, в БД — только
 * `tokenHash` (sha256). E-mail (нормализованный) хранится только у `pending`; закрытие (принято, отозвано, заменено)
 * пишет `email: null`. `purgeAt` — TTL-уборка: `pending` — `expiresAt + 30 сут`, закрытые — закрытие + 30 сут. Срок
 * проверяет сервер по `CLOCK`. `version` — замок принятия/отзыва (`$inc` в транзакции).
 */
export interface PanelInvitationDoc {
  _id: string;
  email: string | null;
  role: PanelRole;
  displayName: string;
  /** userId пригласившего сотрудника. */
  invitedBy: string;
  tokenHash: string;
  status: PanelInvitationStatus;
  revokedReason: 'revoked' | 'replaced' | null;
  emailState: InvitationEmailState;
  createdAt: Date;
  expiresAt: Date;
  acceptedUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  purgeAt: Date;
  version: number;
}

export type AuditActor = { kind: 'user'; userId: string } | { kind: 'cli' };

/** Объект действия доменного модуля: `label` — название на момент действия (снимок, R7 admin-02). */
export interface AuditSubjectDoc {
  kind: AuditSubjectKind;
  id: string;
  label: string;
}

/** Детали записи: смена роли (admin-01), имена изменённых полей и шаблон причины отмены (admin-02) — без значений. */
export interface AuditDetailsDoc {
  roleFrom?: PanelRole;
  roleTo?: PanelRole;
  changedFields?: string[];
  cancelReason?: RaceCancelReason;
  /** race-results-05: попытка, заявка участника, ревизия протокола */
  attemptId?: string;
  entryId?: string;
  revision?: number;
  /** Модерация райдов (05b): число жалоб, закрытых действием. */
  reportCount?: number;
  /** race-results-06: спор, по которому принято решение */
  disputeId?: string;
  /** app-themes: смена темы приложения */
  themeFrom?: AppThemeId;
  themeTo?: AppThemeId;
  /** halloween-decor: смена сезонного декора */
  decorFrom?: AppDecorId;
  decorTo?: AppDecorId;
  /** routes-06: код причины отклонения заявки маршрута райдера */
  rejectionReason?: RouteRejectionReason;
  /** event-tickets: код отмеченного билета (без имени и e-mail участника) */
  ticketCode?: string;
  /** profile-moderation-followups: сброс фото включил запрет загрузки до этого момента (ISO, как в контракте) */
  avatarBlockedUntil?: string;
  /** achievements-panel: код достижения, вид и id объекта (сезонной — сезон), уровень счётного */
  achievementCode?: AchievementCode;
  objectKind?: AchievementObjectKind;
  objectId?: string;
  achievementLevel?: AchievementLevel;
}

/**
 * Журнал действий панели — append-only (только `insertOne`, `AGENTS.md` §4.10): кто, что, когда, над кем, причина.
 * Без e-mail, IP, UA и имён (имя — из `panel_members` при показе).
 */
export interface PanelAuditDoc {
  _id: string;
  at: Date;
  action: AuditAction;
  actor: AuditActor;
  targetUserId: string | null;
  reason: string | null;
  /** Нет у записей admin-01 — при чтении `null`. */
  subject?: AuditSubjectDoc | null;
  details: AuditDetailsDoc | null;
}

/**
 * Документ-замок набора активных администраторов (`_id: 'admins'`, R7): транзакция, меняющая этот набор, первой
 * операцией пишет `version` — две такие транзакции конфликтуют (write skew «последний админ» невозможен).
 */
export interface PanelMetaDoc {
  _id: 'admins';
  version: number;
}

export interface PanelCollections {
  members: Collection<PanelMemberDoc>;
  sessions: Collection<PanelSessionDoc>;
  audit: Collection<PanelAuditDoc>;
  meta: Collection<PanelMetaDoc>;
  totp: Collection<PanelTotpDoc>;
  challenges: Collection<PanelSignInChallengeDoc>;
  devices: Collection<PanelTrustedDeviceDoc>;
  invitations: Collection<PanelInvitationDoc>;
}

/** Типизированные коллекции панели — для репозитория, миграции и int-тестов. */
export function panelCollections(db: Db): PanelCollections {
  return {
    members: db.collection<PanelMemberDoc>(PANEL_COLLECTIONS.members),
    sessions: db.collection<PanelSessionDoc>(PANEL_COLLECTIONS.sessions),
    audit: db.collection<PanelAuditDoc>(PANEL_COLLECTIONS.audit),
    meta: db.collection<PanelMetaDoc>(PANEL_COLLECTIONS.meta),
    totp: db.collection<PanelTotpDoc>(PANEL_COLLECTIONS.totp),
    challenges: db.collection<PanelSignInChallengeDoc>(PANEL_COLLECTIONS.challenges),
    devices: db.collection<PanelTrustedDeviceDoc>(PANEL_COLLECTIONS.devices),
    invitations: db.collection<PanelInvitationDoc>(PANEL_COLLECTIONS.invitations),
  };
}
