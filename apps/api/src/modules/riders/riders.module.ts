import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { ProfileStatsController } from './profile-stats.controller';
import { RidersPublicController } from './riders-public.controller';
import { RidersService } from './riders.service';

/**
 * Профиль райдера — модуль-композиция (rider-profile, образец — `standings`): статистика своего профиля и публичный
 * профиль. Своих коллекций нет; данные — только порты через `index.ts`: `RIDER_PROFILES` (`profile`), `RIDER_RESULTS`
 * (`results`), `ACTIVITY_TOTALS` (`tracks`, реэкспорт `ResultsCoreModule`). `riders` не импортирует никто, кроме
 * `AppModule` (`profile` не может зависеть от `results`: цикл `results → profile`).
 */
@Module({
  imports: [IdentityModule, ProfileCoreModule, ResultsCoreModule],
  controllers: [ProfileStatsController, RidersPublicController],
  providers: [RidersService, PublicReadGuard],
})
export class RidersModule {}
