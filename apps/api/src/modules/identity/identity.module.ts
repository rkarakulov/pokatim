import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { AccessTokenVerifier } from './access-token';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { CredentialsCheck } from './credentials-check';
import { IdentityAccounts } from './identity-accounts';
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
 * HTTP-часть identity: регистрация, ссылки подтверждения, обмен токена регистрации на сессию, вход, ротация, выход,
 * сброс пароля. `AuthGuard` — авторизация запросов других модулей (импорт `IdentityModule`, ADR-0008).
 */
@Module({
  controllers: [AuthController, SessionController],
  providers: [
    IdentityRepository,
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
    IdentityAccounts,
  ],
  // гард создаётся в модуле-потребителе (`@UseGuards`) — ему нужны и зависимости гарда; сам класс репозитория
  // наружу не экспортируется из `index.ts`: другие модули identity-коллекции не читают
  // `PanelCredentials` и `IdentityAccounts` — узкий порт для модуля `panel` (ADR-0009)
  exports: [AuthGuard, AccessTokenVerifier, IdentityRepository, PanelCredentials, IdentityAccounts],
})
export class IdentityModule {}

/**
 * Только чтения аккаунтов (`IdentityAccounts`) — для CLI панели: без HTTP-части, лимитера и Redis
 * (`createApplicationContext`).
 */
@Module({
  providers: [IdentityRepository, IdentityAccounts],
  exports: [IdentityAccounts],
})
export class IdentityAccountsModule {}

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
