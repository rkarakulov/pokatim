import { Module } from '@nestjs/common';

import { IdentityAccountsModule, IdentityModule } from '../identity';
import { MediaModule } from '../media';
import { PanelModule } from '../panel';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { PublicReadGuard } from '../../public-read.guard';
import { AvatarReissue } from './avatar-reissue';
import { AvatarsPublicController } from './avatars-public.controller';
import { ProfileAdminController } from './profile-admin.controller';
import { ProfileAvatarRepository } from './profile-avatar.repository';
import { ProfileAvatarService } from './profile-avatar.service';
import { ProfileAvatarsController } from './profile-avatars.controller';
import { ProfileController } from './profile.controller';
import { ProfileErasure } from './profile-erasure';
import { ProfilesOverview } from './profiles-overview';
import { ProfileModerationService } from './profile-moderation.service';
import { ProfileReportsRepository } from './profile-reports.repository';
import { ProfileReportsService } from './profile-reports.service';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { RiderNamesService } from './rider-names';
import { RIDER_NAMES } from './rider-names.port';
import { RiderThemesService } from './rider-themes';
import { RIDER_THEMES } from './rider-themes.port';
import { RiderProfilesModerationController } from './rider-profiles-moderation.controller';
import { RiderReportsController } from './rider-reports.controller';
import { RiderProfilesService } from './rider-profiles';
import { RIDER_PROFILES } from './rider-profiles.port';
import { ReservedRiderLines } from './reserved-rider-lines';
import { ProfileVerifiedAdminController } from './profile-verified-admin.controller';
import { ProfileVerifiedAdminService } from './profile-verified-admin.service';
import { VerifiedProfileController } from './verified-profile.controller';
import { VerifiedProfileRepository } from './verified-profile.repository';
import { VerifiedProfileService } from './verified-profile.service';
import { VerifiedProfilesService } from './verified-profiles';
import { VERIFIED_PROFILES } from './verified-profiles.port';

/**
 * Ядро `profile` для API и worker: единственные писатели `profiles` и анкет Verified, порты
 * `RiderNameDirectory` и `VerifiedProfiles` (race-results-07) для `results` (через `index.ts`), `RiderProfileDirectory`
 * (rider-profile) для `riders`, `RiderThemes` (user-theme) для `sharing`, единственный писатель жалоб на профиль
 * (profile-moderation) и порт стирания `ProfileErasure` (`account`), очередь жалоб для «Обзора» панели
 * (`ProfilesOverview`, admin-overview), разовая выборка служебных подписей (`ReservedRiderLines`, CLI) — без контроллеров и без импортов. Репозитории объявлены только здесь (один
 * экземпляр).
 */
@Module({
  providers: [
    ProfileRepository,
    VerifiedProfileRepository,
    ProfileAvatarRepository,
    ProfileReportsRepository,
    RiderNamesService,
    { provide: RIDER_NAMES, useExisting: RiderNamesService },
    RiderProfilesService,
    { provide: RIDER_PROFILES, useExisting: RiderProfilesService },
    RiderThemesService,
    { provide: RIDER_THEMES, useExisting: RiderThemesService },
    VerifiedProfilesService,
    { provide: VERIFIED_PROFILES, useExisting: VerifiedProfilesService },
    ProfileErasure,
    ProfilesOverview,
    ReservedRiderLines,
  ],
  exports: [
    ProfileRepository,
    VerifiedProfileRepository,
    ProfileAvatarRepository,
    ProfileReportsRepository,
    RIDER_NAMES,
    RIDER_PROFILES,
    RIDER_THEMES,
    VERIFIED_PROFILES,
    ProfileErasure,
    ProfilesOverview,
    ReservedRiderLines,
  ],
})
export class ProfileCoreModule {}

/**
 * Профиль райдера: онбординг (опрос «Что вас привело?»), чтение своего профиля, публичное имя и согласие на показ
 * (журнал согласий — profile-02), анкета Verified (race-results-07), клуб и аватар (rider-profile; отдача аватара —
 * `PublicReadGuard`), жалобы на публичный профиль (`riders/:publicId/{me,reports}`, profile-moderation). Авторизация —
 * `AuthGuard` identity; сброс имени (`admin/profiles`) и модерация профилей (`admin/rider-profiles`) — `PanelGuard` +
 * `profiles.moderate`, пол и год анкеты — `profiles.verified_edit`.
 */
@Module({
  imports: [IdentityModule, IdentityAccountsModule, MediaModule, PanelModule, ProfileCoreModule],
  controllers: [
    OnboardingController,
    ProfileController,
    ProfileAvatarsController,
    AvatarsPublicController,
    VerifiedProfileController,
    ProfileAdminController,
    ProfileVerifiedAdminController,
    RiderReportsController,
    RiderProfilesModerationController,
  ],
  providers: [
    OnboardingService,
    ProfileService,
    ProfileModerationService,
    VerifiedProfileService,
    ProfileVerifiedAdminService,
    ProfileAvatarService,
    AvatarReissue,
    ProfileReportsService,
    PublicReadGuard,
  ],
})
export class ProfileModule {}
