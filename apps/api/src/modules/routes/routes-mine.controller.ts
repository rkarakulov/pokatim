import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  FieldErrorCode,
  type MyRoute,
  type MyRoutePage,
  MyRouteQuery,
  RenameRouteInput,
  type RouteMapGeometry,
  SubmitRoutePublicationInput,
  UploadRouteQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { readLimited } from '../../raw-body';
import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { MyRoutePublicationService } from './my-route-publication.service';
import { MyRoutesService } from './my-routes.service';
import { ROUTE_POLICY } from './routes.policy';

/** Ответ Fastify: код статуса (202 — маршрут поставлен в обработку, 200 — тот же файл) и заголовок. */
interface StatusReply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const UPLOAD_ERRORS = {
  unsupported: 'ROUTE_FORMAT_UNSUPPORTED',
  tooLarge: 'ROUTE_TOO_LARGE',
} as const;

/**
 * Мои маршруты (routes-02) — только вошедшим (`AuthGuard`), `no-store`; чужой и неизвестный — 404. Статический
 * сегмент `routes/mine` — **первым** контроллером модуля (до публичного `routes/:id`, иначе pipe `Uuid` → 400).
 * Мутации — `POST` с глаголом (CORS API без `DELETE`).
 */
@Controller('routes/mine')
@UseGuards(AuthGuard)
export class RoutesMineController {
  constructor(
    private readonly routes: MyRoutesService,
    private readonly publication: MyRoutePublicationService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  async upload(
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Query(new ZodValidationPipe(UploadRouteQuery, FieldErrorCode)) query: UploadRouteQuery,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<MyRoute> {
    const slot = await this.routes.admit(user.userId, ip);
    try {
      const bytes = await readLimited(
        body,
        ROUTE_POLICY.maxFileBytes,
        UPLOAD_ERRORS,
        ROUTE_POLICY.bodyTimeouts,
      ).catch((error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      });
      const result = await this.routes.upload(user.userId, query.title, bytes);
      reply.status(result.created ? 202 : 200);
      return result.route;
    } finally {
      slot.release();
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(MyRouteQuery, FieldErrorCode)) query: MyRouteQuery,
  ): Promise<MyRoutePage> {
    return this.routes.list(user.userId, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<MyRoute> {
    return this.routes.get(user.userId, id);
  }

  @Get(':id/map')
  @Header('Cache-Control', 'no-store')
  map(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RouteMapGeometry> {
    return this.routes.map(user.userId, id);
  }

  @Post(':id/rename')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RenameRouteInput, FieldErrorCode)) body: RenameRouteInput,
  ): Promise<MyRoute> {
    return this.routes.rename(user.userId, id, body.title);
  }

  /** routes-06: заявка в каталог (премодерация). */
  @Post(':id/publish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SubmitRoutePublicationInput, FieldErrorCode))
    body: SubmitRoutePublicationInput,
  ): Promise<MyRoute> {
    return this.publication.submit(user.userId, id, body);
  }

  /** routes-06: отозвать заявку или снять с публикации. */
  @Post(':id/unpublish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  unpublish(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<MyRoute> {
    return this.publication.withdraw(user.userId, id);
  }

  @Post(':id/delete')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async delete(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<void> {
    await this.routes.delete(user.userId, id);
  }
}
