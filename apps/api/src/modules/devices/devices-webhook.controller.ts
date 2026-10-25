import type { IncomingMessage } from 'node:http';

import { Controller, Header, HttpCode, Ip, Post, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';

import { DevicesWebhookService } from './devices-webhook.service';
import { RAW_BODY_ROUTE, rawBodyOf } from './webhook-raw-body';

interface WebhookRequest {
  raw: IncomingMessage;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Вебхук агрегатора (`POST /v1/devices/webhook`, без входа — подпись Svix): сырые байты тела — хук
 * `WebhookRawBodyHook` по флагу маршрута; проверка и постановка pull — `DevicesWebhookService`.
 */
@Controller('devices/webhook')
export class DevicesWebhookController {
  constructor(private readonly webhooks: DevicesWebhookService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RouteConfig({ [RAW_BODY_ROUTE]: true })
  async receive(@Req() request: WebhookRequest, @Ip() ip: string): Promise<void> {
    await this.webhooks.receive(request.headers, rawBodyOf(request), ip);
  }
}
