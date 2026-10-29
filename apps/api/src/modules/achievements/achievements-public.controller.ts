import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type PublicRiderAchievementList, RiderPublicId } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { AchievementsService } from './achievements.service';

const publicIdPipe = new ZodValidationPipe(RiderPublicId, FieldErrorCode);

/**
 * Публичные достижения райдера (A7, RC-5): только гоночные, без входа, IP-лимит `public-read`, `public, max-age=60`;
 * доступ — по `publicId` при имени и согласии (иначе 404). Путь `riders/:publicId/achievements` отличается от
 * `riders/:publicId` (`riders`) и `riders/:publicId/{me,reports}` (`profile`) статическим сегментом.
 */
@Controller('riders')
@UseGuards(PublicReadGuard)
export class AchievementsPublicController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get(':publicId/achievements')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  list(@Param('publicId', publicIdPipe) publicId: string): Promise<PublicRiderAchievementList> {
    return this.achievements.publicList(publicId);
  }
}
