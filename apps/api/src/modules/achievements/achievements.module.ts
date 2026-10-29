import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { RouteRidesCoreModule } from '../route-rides';
import { AchievementErasure } from './achievement-erasure';
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
 * Достижения райдера (ADR-0020) — модуль-композиция (образец `riders` + `standings`): факты — только порты через
 * `index.ts` (`results` `RIDER_RESULTS`, `route-rides` `RIDER_ROUTE_RIDES`, `rides` `RIDER_RIDES`, `profile`
 * `RIDER_PROFILES`); своя коллекция выдач. Worker-модуля, очередей и outbox нет (A2). `achievements` импортируют
 * только `AppModule` (`AchievementsModule`) и `AccountWorkerModule` (`AchievementsCoreModule`, стирание).
 */
@Module({
  imports: [
    IdentityModule,
    ProfileCoreModule,
    ResultsCoreModule,
    RidesCoreModule,
    RouteRidesCoreModule,
    AchievementsCoreModule,
  ],
  controllers: [AchievementsController, AchievementsPublicController],
  providers: [AchievementsService, PublicReadGuard],
})
export class AchievementsModule {}
