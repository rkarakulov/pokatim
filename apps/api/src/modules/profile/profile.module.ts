import { Module } from '@nestjs/common';

import { IdentityAccountsModule, IdentityModule } from '../identity';
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
import { ProfileVerifiedAdminController } from './profile-verified-admin.controller';
import { ProfileVerifiedAdminService } from './profile-verified-admin.service';
import { VerifiedProfileController } from './verified-profile.controller';
import { VerifiedProfileRepository } from './verified-profile.repository';
import { VerifiedProfileService } from './verified-profile.service';
import { VerifiedProfilesService } from './verified-profiles';
import { VERIFIED_PROFILES } from './verified-profiles.port';

/**
 * Ядро `profile` для API и worker: единственные писатели `profiles` и анкет Verified, порты
 * `RiderNameDirectory` и `VerifiedProfiles` (race-results-07) для `results` (через `index.ts`) и порт стирания
 * `ProfileErasure` (`account`) — без контроллеров и без импортов. Репозитории объявлены только здесь (один экземпляр).
 */
@Module({
  providers: [
    ProfileRepository,
    VerifiedProfileRepository,
    RiderNamesService,
    { provide: RIDER_NAMES, useExisting: RiderNamesService },
    VerifiedProfilesService,
    { provide: VERIFIED_PROFILES, useExisting: VerifiedProfilesService },
    ProfileErasure,
  ],
  exports: [
    ProfileRepository,
    VerifiedProfileRepository,
    RIDER_NAMES,
    VERIFIED_PROFILES,
    ProfileErasure,
  ],
})
export class ProfileCoreModule {}

/**
 * Профиль райдера: онбординг (опрос «Что вас привело?»), чтение своего профиля, публичное имя и согласие на показ
 * (журнал согласий — profile-02), анкета Verified (race-results-07). Авторизация — `AuthGuard` identity; сброс имени
 * модератором (`admin/profiles`) — `PanelGuard` + `profiles.moderate`, пол и год анкеты — `profiles.verified_edit`.
 */
@Module({
  imports: [IdentityModule, IdentityAccountsModule, PanelModule, ProfileCoreModule],
  controllers: [
    OnboardingController,
    ProfileController,
    VerifiedProfileController,
    ProfileAdminController,
    ProfileVerifiedAdminController,
  ],
  providers: [
    OnboardingService,
    ProfileService,
    ProfileModerationService,
    VerifiedProfileService,
    ProfileVerifiedAdminService,
  ],
})
export class ProfileModule {}
