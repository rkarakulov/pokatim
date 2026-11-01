import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type SitemapIndex,
  type SitemapPage,
  SitemapPageParams,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { SitemapService } from './sitemap.service';

const pageParamsPipe = new ZodValidationPipe(SitemapPageParams, FieldErrorCode);

/**
 * Карта сайта (landing-seo, sitemap-index): без входа, только опубликованное, IP-лимит `public-read`, кэш 60 с.
 * Индекс — страницы видов; страница — объекты по `_id` ↑. Страница вне индекса — `404`, неверный вид или номер — `400`.
 */
@Controller('sitemap')
@UseGuards(PublicReadGuard)
export class SitemapController {
  constructor(private readonly service: SitemapService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  index(): Promise<SitemapIndex> {
    return this.service.index();
  }

  @Get(':kind/:page')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  async page(@Param(pageParamsPipe) { kind, page }: SitemapPageParams): Promise<SitemapPage> {
    const found = await this.service.page(kind, page);
    if (!found) throw domainError('NOT_FOUND', 404);
    return found;
  }
}
