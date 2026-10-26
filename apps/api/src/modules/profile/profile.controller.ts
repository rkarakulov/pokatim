import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type ProfileView, UpdateProfileRequest } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { ProfileService } from './profile.service';

/** Профиль своего пользователя — только для вошедших; пользователь — из access, пути с id нет. */
@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  view(@CurrentUser() user: AuthUser): Promise<ProfileView> {
    return this.profile.view(user.userId);
  }

  /** Публичное имя и согласие на показ в таблицах результатов (profile-rider-name): частичное обновление. */
  @Patch()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProfileRequest, FieldErrorCode)) body: UpdateProfileRequest,
  ): Promise<ProfileView> {
    return this.profile.update(user.userId, body);
  }
}
