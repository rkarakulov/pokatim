import { Injectable } from '@nestjs/common';

import { type IdentityAccountConfirmed, IdentityAccounts } from '../identity';
import { SocialConnectionsService } from './connections.service';
import { InviteCodes } from './invite-codes.service';

/** Итог обработки приглашения: связь (создана впервые или уже была) или причина без связи. */
export type InviteIntakeOutcome =
  'linked' | 'already_linked' | 'unknown_code' | 'self' | 'inviter_deleted' | 'invitee_deleted';

/**
 * Приглашённый подтвердил e-mail (`identity.account-confirmed`, P6): код → пригласивший, связь `invite` в обе стороны
 * (`linkInvite`). Живость обоих — порт `IdentityAccounts` до транзакции; удаление, закоммиченное позже, уберёт повторный
 * проход стирания (RC-P6-9). Идемпотентно: повтор задачи — `already_linked` без событий.
 */
@Injectable()
export class InviteIntake {
  constructor(
    private readonly codes: InviteCodes,
    private readonly accounts: IdentityAccounts,
    private readonly connections: SocialConnectionsService,
  ) {}

  async handle(event: IdentityAccountConfirmed): Promise<InviteIntakeOutcome> {
    const inviterId = await this.codes.ownerOf(event.invite);
    if (!inviterId) return 'unknown_code';
    if (inviterId === event.userId) return 'self';
    // `deletedAt` закрывает окно «помечен удалённым, стирание social ещё не прошло»
    const live = await this.accounts.liveUserIds([inviterId, event.userId]);
    if (!live.has(inviterId)) return 'inviter_deleted';
    if (!live.has(event.userId)) return 'invitee_deleted';
    const registered = await this.connections.linkInvite(inviterId, event.userId);
    // P7: уведомление пригласившему K10 «По вашей ссылке зарегистрировались» — здесь, по
    // { inviterId, inviteeId: event.userId, registered }
    return registered ? 'linked' : 'already_linked';
  }
}
