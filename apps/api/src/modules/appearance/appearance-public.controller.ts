import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { AppAppearance } from '@pokatim/contracts';

import { PublicReadGuard } from '../../public-read.guard';
import { AppearanceService } from './appearance.service';

/**
 * Тема приложения (app-themes): без входа, одинакова для всех, IP-лимит `public-read`. Кэш браузера — `no-cache`, не
 * общие 60 с публичного чтения: после смены темы в панели закэшированный ответ перекрашивал свежую SSR-страницу в
 * прежнюю тему. Запрос — раз на загрузку и на возврат фокуса, ответ — один ключ.
 */
@Controller('appearance')
@UseGuards(PublicReadGuard)
export class AppearancePublicController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  @Header('Cache-Control', 'no-cache')
  get(): Promise<AppAppearance> {
    return this.appearance.getPublic();
  }
}
