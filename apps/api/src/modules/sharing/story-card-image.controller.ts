import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { domainError } from '../../error-messages';
import { IpRateLimit, IpRateLimitGuard } from '../../public-read.guard';
import { STORY_CARD_POLICY } from './sharing.policy';
import { StoryCardImageService } from './story-card-image.service';

/** Имя файла картинки: `<токен 22 символа base64url>.png`. */
const FILE = /^([A-Za-z0-9_-]{22})\.png$/;

/**
 * PNG карточки для сторис по капабилити-токену (story-cards, ADR-0018): без входа (так картинку берут `<img>`,
 * `fetch`, загрузчик файла без заголовков), IP-лимит `story-card-image`. Кривое имя, неизвестный токен и отозванная
 * картинка приглашения (`StoryCardImageService`, ride-photo-followups) — один `404` JSON. Заголовки файла — после чтения (Nest пишет `@Header` до обработчика: 404 с типом картинки не
 * сериализовался бы в JSON).
 */
@Controller('story-cards')
export class StoryCardImageController {
  constructor(
    private readonly images: StoryCardImageService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get(':file')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('story-card-image', STORY_CARD_POLICY.imageIpLimit)
  async image(
    @Param('file') file: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    const token = FILE.exec(file)?.[1];
    const png = token ? await this.images.png(token) : null;
    if (!png) throw domainError('NOT_FOUND', 404);
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(reply, 'Content-Type', 'image/png');
    adapter.setHeader(reply, 'Cache-Control', 'private, max-age=86400, immutable');
    adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
    adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
    adapter.setHeader(reply, 'Referrer-Policy', 'no-referrer');
    adapter.setHeader(reply, 'Content-Disposition', 'inline; filename="pokatim-story.png"');
    return png;
  }
}
