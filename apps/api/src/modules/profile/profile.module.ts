import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileAdminController } from './profile-admin.controller';
import { ProfileController } from './profile.controller';
import { ProfileErasure } from './profile-erasure';
import { ProfileModerationService } from './profile-moderation.service';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { RiderNamesService } from './rider-names';
import { RIDER_NAMES } from './rider-names.port';

/**
 * Ядро `profile` для API и worker: единственный писатель `profiles` и порт `RiderNameDirectory` для `results` (через
 * `index.ts`) и порт стирания `ProfileErasure` (`account`) — без контроллеров и без импортов. `ProfileRepository` объявлен только здесь (один экземпляр).
 */
@Module({
  providers: [
    ProfileRepository,
    RiderNamesService,
    { provide: RIDER_NAMES, useExisting: RiderNamesService },
    ProfileErasure,
  ],
  exports: [ProfileRepository, RIDER_NAMES, ProfileErasure],
})
export class ProfileCoreModule {}

/**
 * Профиль райдера: онбординг (опрос «Что вас привело?»), чтение своего профиля, публичное имя и согласие на показ
 * (журнал согласий — profile-02). Авторизация — `AuthGuard` identity; сброс имени модератором (`admin/profiles`) —
 * `PanelGuard` + `profiles.moderate` из `panel`.
 */
@Module({
  imports: [IdentityModule, PanelModule, ProfileCoreModule],
  controllers: [OnboardingController, ProfileController, ProfileAdminController],
  providers: [OnboardingService, ProfileService, ProfileModerationService],
})
export class ProfileModule {}
