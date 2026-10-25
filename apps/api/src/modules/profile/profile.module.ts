import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileController } from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

/**
 * Профиль райдера: онбординг (опрос «Что вас привело?») и чтение своего профиля. Авторизация — `AuthGuard`
 * identity.
 */
@Module({
  imports: [IdentityModule],
  controllers: [OnboardingController, ProfileController],
  providers: [ProfileRepository, OnboardingService, ProfileService],
})
export class ProfileModule {}
