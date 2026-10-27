import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { AppAppearance } from '@pokatim/contracts';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { AppearanceService } from './appearance.service';

/** Тема приложения (app-themes): без входа, одинакова для всех, кэш 60 с, IP-лимит `public-read`. */
@Controller('appearance')
@UseGuards(PublicReadGuard)
export class AppearancePublicController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(): Promise<AppAppearance> {
    return this.appearance.getPublic();
  }
}
