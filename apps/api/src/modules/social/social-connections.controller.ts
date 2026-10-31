import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SocialConnections } from '@pokatim/contracts';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RiderSocialService } from './rider-social.service';

/** «Свои» вошедшего (P3, K6): список и «Свои · N». `AuthGuard`, `no-store`. */
@Controller('social')
@UseGuards(AuthGuard)
export class SocialConnectionsController {
  constructor(private readonly social: RiderSocialService) {}

  @Get('connections')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<SocialConnections> {
    return this.social.connectionsOf(user.userId);
  }
}
