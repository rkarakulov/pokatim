export { identityOutboxRoutes } from './identity.events';
export { IdentityAccountsModule, IdentityModule, IdentityWorkerModule } from './identity.module';
export { type AccountState, IdentityAccounts } from './identity-accounts';
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
