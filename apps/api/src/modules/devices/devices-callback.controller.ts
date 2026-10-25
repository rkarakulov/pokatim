import { Controller, Get, Query, Res } from '@nestjs/common';

import { DevicesLinkService } from './devices-link.service';

/** Ответ Fastify: код, заголовки, пустое тело. */
interface RedirectReply {
  status(code: number): RedirectReply;
  header(name: string, value: string): RedirectReply;
  send(): unknown;
}

/**
 * Возврат браузера из агрегатора после авторизации у провайдера (R4): **без входа** — ничего не меняет, только 302
 * на `returnUrl` тикета (`?provider&result=pending&t`) или на web-ссылку по умолчанию с `result=error`.
 * `Referrer-Policy: no-referrer` (тикет в адресе не уходит третьим сайтам), `no-store`; тикет в логи не пишется.
 */
@Controller('devices/callback')
export class DevicesCallbackController {
  constructor(private readonly link: DevicesLinkService) {}

  @Get()
  async callback(@Query('t') ticket: unknown, @Res() reply: RedirectReply): Promise<void> {
    const location = await this.link.callbackLocation(ticket);
    reply
      .status(302)
      .header('Location', location)
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store')
      .send();
  }
}
