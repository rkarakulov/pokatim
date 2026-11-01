import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  FailedJobActionRequest,
  FailedJobId,
  FailedJobsQuery,
  type FailedJobsView,
  FieldErrorCode,
  QueueName,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { FailedJobsAdminService } from './failed-jobs-admin.service';

/**
 * «Упавшие задачи» панели (admin-failed-jobs, `platform.stats` — только admin): провалы BullMQ и застрявший outbox,
 * «Повторить» и «Удалить» с причиной. `no-store` ставит `PanelGuard`.
 */
@Controller('admin/failed-jobs')
@UseGuards(PanelGuard)
@RequirePermission('platform.stats')
export class FailedJobsAdminController {
  constructor(private readonly jobs: FailedJobsAdminService) {}

  @Get()
  view(
    @Query(new ZodValidationPipe(FailedJobsQuery, FieldErrorCode)) query: FailedJobsQuery,
  ): Promise<FailedJobsView> {
    return this.jobs.view(query);
  }

  @Post(':queue/:jobId/retry')
  @HttpCode(204)
  retry(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('queue', new ZodValidationPipe(QueueName, FieldErrorCode)) queue: string,
    @Param('jobId', new ZodValidationPipe(FailedJobId, FieldErrorCode)) jobId: string,
    @Body(new ZodValidationPipe(FailedJobActionRequest, FieldErrorCode))
    body: FailedJobActionRequest,
  ): Promise<void> {
    return this.jobs.retry(actor.userId, queue, jobId, body);
  }

  @Post(':queue/:jobId/delete')
  @HttpCode(204)
  remove(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('queue', new ZodValidationPipe(QueueName, FieldErrorCode)) queue: string,
    @Param('jobId', new ZodValidationPipe(FailedJobId, FieldErrorCode)) jobId: string,
    @Body(new ZodValidationPipe(FailedJobActionRequest, FieldErrorCode))
    body: FailedJobActionRequest,
  ): Promise<void> {
    return this.jobs.remove(actor.userId, queue, jobId, body);
  }
}
