import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PublicRiderProfile,
  type PublicRiderRacePage,
  RiderHistoryQuery,
  RiderPublicId,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { RidersService } from './riders.service';

const publicIdPipe = new ZodValidationPipe(RiderPublicId, FieldErrorCode);

/**
 * Публичный профиль райдера (rider-profile): без входа, IP-лимит `public-read`, `public, max-age=60`; доступ — по
 * непредсказуемому `publicId` и только при имени и согласии (иначе 404). Мутаций нет.
 */
@Controller('riders')
@UseGuards(PublicReadGuard)
export class RidersPublicController {
  constructor(private readonly riders: RidersService) {}

  @Get(':publicId')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(@Param('publicId', publicIdPipe) publicId: string): Promise<PublicRiderProfile> {
    return this.riders.publicProfile(publicId);
  }

  @Get(':publicId/races')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  races(
    @Param('publicId', publicIdPipe) publicId: string,
    @Query(new ZodValidationPipe(RiderHistoryQuery, FieldErrorCode)) query: RiderHistoryQuery,
  ): Promise<PublicRiderRacePage> {
    return this.riders.publicRaces(publicId, query);
  }
}
