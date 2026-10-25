import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type OnboardingStatus,
  SubmitOnboardingSurveyRequest,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { OnboardingService } from './onboarding.service';

/** Онбординг профиля — только для вошедших; пользователь — из access (`@CurrentUser()`), не из тела или пути. */
@Controller('profile/onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() user: AuthUser): Promise<OnboardingStatus> {
    return this.onboarding.status(user.userId);
  }

  @Put('survey')
  @Header('Cache-Control', 'no-store')
  submitSurvey(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitOnboardingSurveyRequest, FieldErrorCode))
    body: SubmitOnboardingSurveyRequest,
  ): Promise<OnboardingStatus> {
    return this.onboarding.submit(user.userId, body.reasons);
  }
}
