import { Inject, Injectable } from '@nestjs/common';

import { IdentityAccounts } from '../identity';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { maskEmail, TICKETS_POLICY } from './tickets.policy';

/**
 * Имена участников для панели (check-in, список участников) — служебный показ с правом: публичное имя профиля без
 * условия согласия (`attributionNames`); нет имени — «Участник · r***@gmail.com»; удалённый — «Участник».
 */
@Injectable()
export class ParticipantNames {
  constructor(
    private readonly identity: IdentityAccounts,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async of(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const names = await this.names.attributionNames(unique);
    const unnamed = unique.filter((userId) => !names.has(userId));
    const emails =
      unnamed.length > 0 ? await this.identity.emailsOf(unnamed) : new Map<string, string>();
    return new Map(
      unique.map((userId) => {
        const email = emails.get(userId);
        const fallback = email
          ? `${TICKETS_POLICY.anonymousName} · ${maskEmail(email)}`
          : TICKETS_POLICY.anonymousName;
        return [userId, names.get(userId) ?? fallback] as const;
      }),
    );
  }
}
