import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { ProfileView } from '@pokatim/contracts';

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
}
