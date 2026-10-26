import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CancelRideRequest,
  CreateRideRequest,
  FieldErrorCode,
  type RideCities,
  RideListQuery,
  type RidePage,
  type RideView,
  UpdateRideRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RidesFeedService } from './rides-feed.service';
import { RidesService } from './rides.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * «Я иду» / «Не иду» — без тела (как `devices/:provider/sync`): действие задаёт путь, пользователь — access.
 *
 * Кофе-райды вошедшего райдера (ADR-0008): лента, города, состояние зрителя и все мутации. Пользователь — только
 * `@CurrentUser()`. Регистрируется до публичного контроллера; `rides/cities` — статический путь и не уходит в pipe
 * `Uuid` публичного `rides/:id`.
 */
@Controller('rides')
@UseGuards(AuthGuard)
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly feed: RidesFeedService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RideListQuery, FieldErrorCode)) query: RideListQuery,
  ): Promise<RidePage> {
    return this.feed.list(user.userId, query);
  }

  @Get('cities')
  @Header('Cache-Control', 'no-store')
  cities(@CurrentUser() user: AuthUser): Promise<RideCities> {
    return this.feed.cities(user.userId);
  }

  @Get(':id/me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideView> {
    return this.feed.me(user.userId, id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateRideRequest, FieldErrorCode)) body: CreateRideRequest,
  ): Promise<RideView> {
    return this.rides.create(user.userId, body);
  }

  @Post(':id')
  @HttpCode(200)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRideRequest, FieldErrorCode)) body: UpdateRideRequest,
  ): Promise<RideView> {
    return this.rides.update(user.userId, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelRideRequest, FieldErrorCode)) body: CancelRideRequest,
  ): Promise<RideView> {
    return this.rides.cancel(user.userId, id, body);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideView> {
    return this.rides.join(user.userId, id);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideView> {
    return this.rides.leave(user.userId, id);
  }
}
