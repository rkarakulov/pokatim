import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { RiderStats } from '@pokatim/contracts';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RidersService } from './riders.service';

/** Статистика своего профиля (rider-profile): только вошедший; путь под `/profile` — в модуле `riders`. */
@Controller('profile/stats')
@UseGuards(AuthGuard)
export class ProfileStatsController {
  constructor(private readonly riders: RidersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  stats(@CurrentUser() user: AuthUser): Promise<RiderStats> {
    return this.riders.stats(user.userId);
  }
}
