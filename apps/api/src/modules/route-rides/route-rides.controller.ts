import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type RouteRideCandidates,
  type RouteRideDetail,
  type RouteRideLeaderboard,
  RouteRideLeaderboardQuery,
  type RouteRidePage,
  RouteRideRequest,
  type RouteRideTrack,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RouteRideLeaderboardService } from './route-ride-leaderboard.service';
import { RouteRidesReadService } from './route-rides-read.service';
import { RouteRidesService } from './route-rides.service';

/** Ответ Fastify: код статуса (201 — новый заезд, 200 — уже есть). */
interface StatusReply {
  status(code: number): unknown;
}

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Заезд по маршруту (route-rides-01) — только вошедшие, `no-store`, только свои заезды; пользователь — из access
 * (`@CurrentUser`). Маршрут, не видимый райдеру сейчас, — один `404 NOT_FOUND` на всех ручках. `candidates` и
 * `leaderboard` (route-rides-04: чужие заезды только с согласием, маршрут только каталога) объявлены до `:rideId`
 * (статический сегмент не уходит в pipe `Uuid`).
 */
@Controller('routes/:routeId/rides')
@UseGuards(AuthGuard)
export class RouteRidesController {
  constructor(
    private readonly rides: RouteRidesService,
    private readonly read: RouteRidesReadService,
    private readonly leaderboards: RouteRideLeaderboardService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
  ): Promise<RouteRidePage> {
    return this.read.list(user.userId, routeId);
  }

  @Get('candidates')
  @Header('Cache-Control', 'no-store')
  candidates(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
  ): Promise<RouteRideCandidates> {
    return this.read.candidates(user.userId, routeId);
  }

  /** Таблица «Другие» маршрута каталога (route-rides-04): райдеры с согласием и своя строка. */
  @Get('leaderboard')
  @Header('Cache-Control', 'no-store')
  leaderboard(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
    @Query(new ZodValidationPipe(RouteRideLeaderboardQuery, FieldErrorCode))
    query: RouteRideLeaderboardQuery,
  ): Promise<RouteRideLeaderboard> {
    return this.leaderboards.table(user.userId, routeId, query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async check(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
    @Body(new ZodValidationPipe(RouteRideRequest, FieldErrorCode)) body: RouteRideRequest,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<RouteRideDetail> {
    const result = await this.rides.check(user.userId, routeId, body);
    reply.status(result.created ? 201 : 200);
    return result.ride;
  }

  @Get(':rideId')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
    @Param('rideId', idPipe) rideId: string,
  ): Promise<RouteRideDetail> {
    return this.read.detail(user.userId, routeId, rideId);
  }

  @Get(':rideId/track')
  @Header('Cache-Control', 'no-store')
  track(
    @CurrentUser() user: AuthUser,
    @Param('routeId', idPipe) routeId: string,
    @Param('rideId', idPipe) rideId: string,
  ): Promise<RouteRideTrack> {
    return this.read.track(user.userId, routeId, rideId);
  }
}
