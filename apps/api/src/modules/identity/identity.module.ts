import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { AccessTokenVerifier } from './access-token';
import { AccountClosure } from './account-closure';
import { AccountErasure } from './account-erasure';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { CredentialsCheck } from './credentials-check';
import { IdentityAccounts } from './identity-accounts';
import { ErasureFailures } from './erasure-failures';
import { IdentityOverview } from './identity-overview';
import { IdentityRepository } from './identity.repository';
import { CleanupUnverifiedProcessor } from './jobs/cleanup-unverified.processor';
import { IdentitySchedules } from './jobs/identity-schedules';
import { IdentityEmailProcessor } from './jobs/identity-email.processor';
import { LinkEmailHandler } from './jobs/link-email.handler';
import { PasswordChangedEmailHandler } from './jobs/password-changed-email.handler';
import { PasswordHasher } from './password-hasher';
import { PanelCredentials } from './panel-credentials';
import { PasswordResetService } from './password-reset.service';
import { RegistrationService } from './registration.service';
import { SessionController } from './session.controller';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';
import { SignInService } from './sign-in.service';
import { VerificationService } from './verification.service';

/**
 * Репозиторий identity и чтения аккаунтов (`IdentityAccounts`) — один экземпляр репозитория на приложение: его
 * импортируют `IdentityModule` и CLI панели (без HTTP-части, лимитера и Redis, `createApplicationContext`). Счётчики
 * «Обзора» панели — `IdentityOverview` (admin-overview).
 */
@Module({
  providers: [IdentityRepository, IdentityAccounts, IdentityOverview, ErasureFailures],
  exports: [IdentityRepository, IdentityAccounts, IdentityOverview, ErasureFailures],
})
export class IdentityAccountsModule {}

/**
 * HTTP-часть identity: регистрация, ссылки подтверждения, обмен токена регистрации на сессию, вход, ротация, выход,
 * сброс пароля. `AuthGuard` — авторизация запросов других модулей (импорт `IdentityModule`, ADR-0008).
 */
@Module({
  imports: [IdentityAccountsModule],
  controllers: [AuthController, SessionController],
  providers: [
    AccessTokenVerifier,
    AuthGuard,
    PasswordHasher,
    SessionService,
    SessionCookie,
    VerificationService,
    RegistrationService,
    CredentialsCheck,
    SignInService,
    PasswordResetService,
    PanelCredentials,
    AccountClosure,
  ],
  // гард создаётся в модуле-потребителе (`@UseGuards`) — ему нужны и зависимости гарда; сам класс репозитория
  // наружу не экспортируется из `index.ts`: другие модули identity-коллекции не читают
  // `PanelCredentials` и `IdentityAccounts` — узкий порт для модуля `panel` (ADR-0009); `AccountClosure` и
  // `SessionCookie` — для удаления аккаунта (модуль `account`, ADR-0015)
  exports: [
    AuthGuard,
    AccessTokenVerifier,
    PanelCredentials,
    IdentityAccountsModule,
    AccountClosure,
    SessionCookie,
  ],
})
export class IdentityModule {}

/** Задачи identity в worker: письма (подтверждение, сброс пароля, «Пароль изменён») и очистка неподтверждённых. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE.identityEmail }, { name: QUEUE.identityMaintenance }),
  ],
  providers: [
    IdentityRepository,
    IdentityEmailProcessor,
    LinkEmailHandler,
    PasswordChangedEmailHandler,
    CleanupUnverifiedProcessor,
    IdentitySchedules,
  ],
})
export class IdentityWorkerModule {}

/**
 * Порт фоновой очистки удалённого аккаунта для worker (`AccountErasure`, модуль `account`, ADR-0015): письмо «Аккаунт
 * удалён» и стирание ПДн. `MAILER` — из `MailModule` worker.
 */
@Module({
  imports: [IdentityAccountsModule],
  providers: [AccountErasure],
  exports: [AccountErasure],
})
export class IdentityErasureModule {}
