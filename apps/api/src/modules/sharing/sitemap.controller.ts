import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SitemapEntries } from '@pokatim/contracts';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { SitemapService } from './sitemap.service';

/** Карта сайта (landing-seo): без входа, только опубликованное, IP-лимит `public-read`, кэш 60 с. */
@Controller('sitemap')
@UseGuards(PublicReadGuard)
export class SitemapController {
  constructor(private readonly service: SitemapService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  entries(): Promise<SitemapEntries> {
    return this.service.entries();
  }
}
