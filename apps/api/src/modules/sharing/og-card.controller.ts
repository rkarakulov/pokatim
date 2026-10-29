import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  OG_BRAND,
  OgCardKind,
  type OgCardMeta,
  OgCardParams,
  OgImageFile,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { IpRateLimit, IpRateLimitGuard, PUBLIC_READ_CACHE_CONTROL } from '../../public-read.guard';
import { type OgImage, OgCardService } from './og-card.service';
import { OG_CARD_POLICY } from './sharing.policy';

/** Ответ Fastify: код, заголовки, тело. */
interface ImageReply {
  status(code: number): ImageReply;
  header(name: string, value: string): ImageReply;
  send(body?: Buffer): unknown;
}

const paramsPipe = new ZodValidationPipe(OgCardParams, FieldErrorCode);
const kindPipe = new ZodValidationPipe(OgCardKind, FieldErrorCode);
const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const filePipe = new ZodValidationPipe(OgImageFile, FieldErrorCode);

const versionOf = (file: string) => file.slice(0, -'.png'.length);
const imagePath = (kind: string, id: string, version: string) =>
  `/v1/og/images/${kind}/${id}/${version}.png`;

/**
 * OG-картинки публичных страниц (og-images, ADR-0018) — без входа. `cards` — текущая версия картинки для SSR
 * (`{ version }`, свой IP-лимит `og-card`: web-сервер ходит с одного адреса); `images` — PNG по версии в имени файла
 * (IP-лимит `og-image`): текущая — `200` с публичным кэшем, старая — `302` на текущую (путь без хоста: API свой origin
 * не знает), нет PNG — бренд-PNG `no-store` (рендер поставлен), нет и бренда — `404`. Непубличный объект — `404` JSON
 * до заголовков файла. Статические пути бренда объявлены до параметрических.
 */
@Controller('og')
export class OgCardController {
  constructor(private readonly service: OgCardService) {}

  @Get(`cards/${OG_BRAND.kind}/${OG_BRAND.id}`)
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('og-card', OG_CARD_POLICY.cardsIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  brandCard(): OgCardMeta {
    return this.service.brandMeta();
  }

  @Get('cards/:kind/:id')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('og-card', OG_CARD_POLICY.cardsIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  card(@Param(paramsPipe) params: OgCardParams): Promise<OgCardMeta> {
    return this.service.meta(params.kind, params.id);
  }

  @Get(`images/${OG_BRAND.kind}/${OG_BRAND.id}/:file`)
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('og-image', OG_CARD_POLICY.imageIpLimit)
  async brandImage(@Param('file', filePipe) file: string, @Res() reply: ImageReply): Promise<void> {
    const image = await this.service.brandImage(versionOf(file));
    this.send(reply, image, OG_BRAND.kind, OG_BRAND.id);
  }

  @Get('images/:kind/:id/:file')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('og-image', OG_CARD_POLICY.imageIpLimit)
  async image(
    @Param('kind', kindPipe) kind: OgCardKind,
    @Param('id', idPipe) id: string,
    @Param('file', filePipe) file: string,
    @Res() reply: ImageReply,
  ): Promise<void> {
    const image = await this.service.image(kind, id, versionOf(file));
    this.send(reply, image, kind, id);
  }

  private send(reply: ImageReply, image: OgImage, kind: string, id: string): void {
    if (image.type === 'redirect') {
      reply
        .status(302)
        .header('Location', imagePath(kind, id, image.version))
        .header('Cache-Control', 'public, max-age=300')
        .send();
      return;
    }
    const png = image.png;
    if (!png) {
      reply.header('Cache-Control', 'no-store');
      throw domainError('NOT_FOUND', 404);
    }
    reply
      .status(200)
      .header('Content-Type', 'image/png')
      .header('Cache-Control', image.type === 'png' ? 'public, max-age=86400' : 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline; filename="pokatim.png"')
      .send(png);
  }
}
