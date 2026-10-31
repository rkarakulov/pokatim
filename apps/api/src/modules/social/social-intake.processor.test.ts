import type { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { InviteIntake } from './invite-intake';
import { SocialIntakeProcessor } from './social-intake.processor';

const USER = '01890a5d-ac96-774b-bcce-b302099a8057';

function processor(payload: unknown) {
  const handle = vi.fn().mockResolvedValue('linked');
  const outbox = { payloadOf: vi.fn().mockResolvedValue(payload) };
  return {
    handle,
    run: (name: string) =>
      new SocialIntakeProcessor(
        { handle } as unknown as InviteIntake,
        outbox as unknown as MongoOutboxReader,
      ).process({ name, data: { outboxEventId: 'evt-1' } } as Job),
  };
}

describe('SocialIntakeProcessor (P6)', () => {
  it('identity.account-confirmed — разобранный payload уходит в InviteIntake', async () => {
    const { handle, run } = processor({ userId: USER, invite: 'k7m2pqx' });
    await expect(run('identity.account-confirmed')).resolves.toBe('linked');
    expect(handle).toHaveBeenCalledWith({ userId: USER, invite: 'K7M2PQX' });
  });

  it('payload не по схеме — skipped, обработчик не вызван', async () => {
    const { handle, run } = processor({ userId: 'nope', invite: 'K7M2PQ0' });
    await expect(run('identity.account-confirmed')).resolves.toBe('skipped');
    expect(handle).not.toHaveBeenCalled();
  });

  it('неизвестное имя задачи — бросок', async () => {
    const { run } = processor({});
    await expect(run('rides.something')).rejects.toThrow(/unknown job/);
    await expect(run('toString')).rejects.toThrow(/unknown job/);
  });
});
