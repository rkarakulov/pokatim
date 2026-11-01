import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SocialHome } from '@pokatim/contracts';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { SocialHomeService } from './social-home.service';

/** Секция «Свои» на Главной (K7, P7): `GET /v1/social/home`, `AuthGuard`, `no-store`, лимит `social-home:<uid>`. */
@Controller('social')
@UseGuards(AuthGuard)
export class SocialHomeController {
  constructor(private readonly home: SocialHomeService) {}

  @Get('home')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthUser): Promise<SocialHome> {
    return this.home.homeOf(user.userId);
  }
}
