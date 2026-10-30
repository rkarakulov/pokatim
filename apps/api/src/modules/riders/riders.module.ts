import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { ProfileStatsController } from './profile-stats.controller';
import { RidersForSharingService } from './riders-for-sharing';
import { RIDERS_FOR_SHARING } from './riders-for-sharing.port';
import { RidersPublicController } from './riders-public.controller';
import { RidersService } from './riders.service';

/**
 * Ядро `riders` без HTTP: порт OG-картинки профиля `RIDERS_FOR_SHARING` (og-rider-season-dark). `RidersCoreModule`
 * импортирует `sharing` (HTTP и worker) — образец `AchievementsReadModule`; сводка — та же `summarize`.
 */
@Module({
  imports: [ProfileCoreModule, ResultsCoreModule],
  providers: [
    RidersForSharingService,
    { provide: RIDERS_FOR_SHARING, useExisting: RidersForSharingService },
  ],
  exports: [RIDERS_FOR_SHARING],
})
export class RidersCoreModule {}

/**
 * Профиль райдера — модуль-композиция (rider-profile, образец — `standings`): статистика своего профиля и публичный
 * профиль. Своих коллекций нет; данные — только порты через `index.ts`: `RIDER_PROFILES` (`profile`), `RIDER_RESULTS`
 * (`results`), `ACTIVITY_TOTALS` (`tracks`, реэкспорт `ResultsCoreModule`). `RidersModule` импортирует только
 * `AppModule`, `RidersCoreModule` — `sharing` (`profile` не может зависеть от `results`: цикл `results → profile`).
 */
@Module({
  imports: [IdentityModule, ProfileCoreModule, ResultsCoreModule],
  controllers: [ProfileStatsController, RidersPublicController],
  providers: [RidersService, PublicReadGuard],
})
export class RidersModule {}
