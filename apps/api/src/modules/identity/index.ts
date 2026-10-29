export { identityOutboxRoutes } from './identity.events';
export {
  IdentityAccountsModule,
  IdentityErasureModule,
  IdentityModule,
  IdentityWorkerModule,
} from './identity.module';
export { AccountClosure, type AccountCloseOutcome } from './account-closure';
export {
  AccountErasure,
  type AccountEraseOptions,
  type AccountEraseOutcome,
} from './account-erasure';
export type { DeletionState } from './identity.repository';
export { SessionCookie } from './session-cookie';
export { type AccountState, IdentityAccounts } from './identity-accounts';
/** Порт «Обзора» панели (admin-overview): регистрации за период и зависшие удаления аккаунтов. */
export { IdentityOverview } from './identity-overview';
export {
  PanelCredentials,
  type PanelCredentialsResult,
  type VerifiedCredentials,
} from './panel-credentials';
export type { AuthUser } from './access-token';
export { AuthGuard } from './auth.guard';
export { CurrentUser } from './current-user.decorator';
/** Непрозрачный токен (32 байта base64url) и его sha256 для БД — общие примитивы токенов (сессия панели). */
export { randomToken, sha256 } from './tokens';
/** Ключ IP-лимита (HMAC адреса, IPv6 — /64) — публичное чтение (`public-read.guard.ts`). */
export { rateLimitKeyForIp } from './tokens';
/** Каркас HTML-письма и экранирование — письма `notifications` (N2, ADR-0017). */
export { escapeHtml, htmlEmail } from './mail/html';
