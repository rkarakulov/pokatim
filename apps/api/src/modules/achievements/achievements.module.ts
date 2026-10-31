import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { RouteRidesCoreModule } from '../route-rides';
import { StandingsCoreModule } from '../standings';
import { AchievementErasure } from './achievement-erasure';
import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementNoticesService } from './achievement-notices';
import { ACHIEVEMENT_NOTICES } from './achievement-notices.port';
import { AchievementsReconciler } from './achievements-reconciler';
import { AchievementsSharing } from './achievements-for-sharing';
import { ACHIEVEMENTS_FOR_SHARING } from './achievements-for-sharing.port';
import { AchievementsPublicController } from './achievements-public.controller';
import { AchievementsController } from './achievements.controller';
import { AchievementsRepository } from './achievements.repository';
import { AchievementsService } from './achievements.service';

/**
 * Ядро `achievements` без HTTP: единственный писатель выдач и порт стирания `AchievementErasure` (модуль `account`,
 * worker). Модулей не импортирует (только `MONGO_DB`).
 */
@Module({
  providers: [AchievementsRepository, AchievementErasure],
  exports: [AchievementsRepository, AchievementErasure],
})
export class AchievementsCoreModule {}

/**
 * Чтение фактов без HTTP: `AchievementFactsReader` (сверка `AchievementsModule`) и порт карточки
 * `ACHIEVEMENTS_FOR_SHARING` (`sharing`, HTTP и worker). Только core-модули источников.
 */
@Module({
  imports: [ResultsCoreModule, RidesCoreModule, RouteRidesCoreModule, AchievementsCoreModule],
  providers: [
    AchievementFactsReader,
    { provide: ACHIEVEMENTS_FOR_SHARING, useClass: AchievementsSharing },
  ],
  exports: [AchievementFactsReader, ACHIEVEMENTS_FOR_SHARING],
})
export class AchievementsReadModule {}

/**
 * Сверка и уведомления без HTTP (achievements-push): `AchievementsReconciler` (одна сверка для `GET /v1/achievements` и
 * серверной сверки) и порт `ACHIEVEMENT_NOTICES` (`notifications`, worker). `StandingsCoreModule` — порт
 * `RIDER_SEASON_STANDINGS`; `MongoTransactions`/`MongoOutboxWriter` — глобальные модули базы.
 */
@Module({
  imports: [AchievementsCoreModule, AchievementsReadModule, StandingsCoreModule],
  providers: [
    AchievementsReconciler,
    { provide: ACHIEVEMENT_NOTICES, useClass: AchievementNoticesService },
  ],
  exports: [AchievementsReconciler, ACHIEVEMENT_NOTICES],
})
export class AchievementsSyncModule {}

/**
 * Достижения райдера (ADR-0020) — модуль-композиция (образец `riders` + `standings`): факты — только порты через
 * `index.ts` (`results` `RIDER_RESULTS`, `route-rides` `RIDER_ROUTE_RIDES`, `rides` `RIDER_RIDES`, `profile`
 * `RIDER_PROFILES`, `standings` `RIDER_SEASON_STANDINGS` — сезонные; факты — `AchievementsReadModule`); свои коллекции
 * выдач. Сверка — `AchievementsSyncModule` (событие outbox `achievements.grant-noticed`, achievements-push).
 * `achievements` импортируют `AppModule` (`AchievementsModule`), `AccountWorkerModule` (`AchievementsCoreModule`,
 * стирание), `sharing` (`AchievementsReadModule`) и `NotificationsWorkerModule` (`AchievementsSyncModule`).
 */
@Module({
  imports: [
    IdentityModule,
    ProfileCoreModule,
    ResultsCoreModule,
    AchievementsCoreModule,
    AchievementsReadModule,
    AchievementsSyncModule,
  ],
  controllers: [AchievementsController, AchievementsPublicController],
  providers: [AchievementsService, PublicReadGuard],
})
export class AchievementsModule {}
