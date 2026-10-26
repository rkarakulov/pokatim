import type {
  AuditAction,
  AuditSubjectKind,
  MemberStatus,
  PanelRole,
  RaceCancelReason,
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
}

/** Типизированные коллекции панели — для репозитория, миграции и int-тестов. */
export function panelCollections(db: Db): PanelCollections {
  return {
    members: db.collection<PanelMemberDoc>(PANEL_COLLECTIONS.members),
    sessions: db.collection<PanelSessionDoc>(PANEL_COLLECTIONS.sessions),
    audit: db.collection<PanelAuditDoc>(PANEL_COLLECTIONS.audit),
    meta: db.collection<PanelMetaDoc>(PANEL_COLLECTIONS.meta),
  };
}
