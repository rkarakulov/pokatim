import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { type AuditPage, AuditQuery, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PanelAuditReader } from './panel-audit';
import { PanelGuard } from './panel.guard';
import { RequirePermission } from './require-permission.decorator';

/** «Журнал действий» (Q12: admin и moderator): новые сверху, курсор, фильтры — только значения после схемы. */
@Controller('admin/audit')
@UseGuards(PanelGuard)
export class PanelAuditController {
  constructor(private readonly reader: PanelAuditReader) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @Query(new ZodValidationPipe(AuditQuery, FieldErrorCode)) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.reader.list(query);
  }
}
