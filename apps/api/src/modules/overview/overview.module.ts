import { Module } from '@nestjs/common';

import { CalendarCoreModule } from '../calendar';
import { IdentityAccountsModule } from '../identity';
import { PanelModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule, ResultsModule } from '../results';
import { RidesCoreModule } from '../rides';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

/**
 * «Обзор» панели (admin-overview) — модуль-композиция (как `riders`, `standings`): своих коллекций нет, счётчики —
 * порты модулей-владельцев через их `index.ts`. `overview` не импортирует никто, кроме `AppModule` (`panel` его
 * импортировать не может: `panel/index.ts` импортируют все модули панели). `ResultsCoreModule` реэкспортирует ядра
 * `races`, `routes` и `tracks`; `ResultsOverview` даёт `ResultsModule`, `DisputesOverview` — `@Global DisputesCoreModule`.
 */
@Module({
  imports: [
    PanelModule,
    IdentityAccountsModule,
    ProfileCoreModule,
    RidesCoreModule,
    CalendarCoreModule,
    ResultsCoreModule,
    ResultsModule,
  ],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
