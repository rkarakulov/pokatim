import { Injectable } from '@nestjs/common';

import { AttendanceRepository } from './attendance.repository';
import { ConnectionsRepository } from './connections.repository';
import { InviteCodesRepository } from './invite-codes.repository';
import { ReactionsRepository } from './reactions.repository';

export interface SocialErasureResult {
  connections: number;
  attendance: number;
  reactions: number;
  codes: number;
}

/**
 * Порт стирания «Свои» удалённого аккаунта (модуль `account`, шаг `social`, K13): без транзакции, идемпотентно.
 * Явка — первой (параллельный пересчёт других уже не видит райдера), затем связи в обе стороны, свои и полученные
 * реакции (счётчики считаются на чтении), код приглашения. Связи остальных участников между собой не меняются (RC-7).
 * Поздние записи убирает повторный проход.
 */
@Injectable()
export class SocialErasure {
  constructor(
    private readonly attendance: AttendanceRepository,
    private readonly connections: ConnectionsRepository,
    private readonly reactions: ReactionsRepository,
    private readonly codes: InviteCodesRepository,
  ) {}

  async erase(userId: string): Promise<SocialErasureResult> {
    const attendance = await this.attendance.pullUser(userId);
    const connections = await this.connections.deleteAllOf(userId);
    const reactions = await this.reactions.deleteAllOf(userId);
    const codes = await this.codes.deleteOf(userId);
    return { connections, attendance, reactions, codes };
  }
}
