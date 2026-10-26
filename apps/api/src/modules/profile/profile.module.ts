import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileController } from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { RiderNamesService } from './rider-names';
import { RIDER_NAMES } from './rider-names.port';

/**
 * Ядро `profile` для API и worker: единственный писатель `profiles` и порт `RiderNameDirectory` для `results` (через
 * `index.ts`) — без контроллеров и без импортов. `ProfileRepository` объявлен только здесь (один экземпляр).
 */
@Module({
  providers: [
    ProfileRepository,
    RiderNamesService,
    { provide: RIDER_NAMES, useExisting: RiderNamesService },
  ],
  exports: [ProfileRepository, RIDER_NAMES],
})
export class ProfileCoreModule {}

/**
 * Профиль райдера: онбординг (опрос «Что вас привело?»), чтение своего профиля, публичное имя и согласие на показ.
 * Авторизация — `AuthGuard` identity.
 */
@Module({
  imports: [IdentityModule, ProfileCoreModule],
  controllers: [OnboardingController, ProfileController],
  providers: [OnboardingService, ProfileService],
})
export class ProfileModule {}
