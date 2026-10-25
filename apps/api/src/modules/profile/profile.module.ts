import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileRepository } from './profile.repository';

/** Профиль райдера: онбординг (опрос «Что вас привело?»). Авторизация — `AuthGuard` identity. */
@Module({
  imports: [IdentityModule],
  controllers: [OnboardingController],
  providers: [ProfileRepository, OnboardingService],
})
export class ProfileModule {}
