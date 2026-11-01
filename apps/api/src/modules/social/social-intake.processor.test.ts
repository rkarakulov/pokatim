import type { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { AutoAttendanceIntake } from './auto-attendance-intake';
import type { InviteIntake } from './invite-intake';
import { SocialIntakeProcessor } from './social-intake.processor';

const USER = '01890a5d-ac96-774b-bcce-b302099a8057';
const ACTIVITY = '01890a5d-ac96-774b-bcce-b302099a8058';
const UPLOAD = '01890a5d-ac96-774b-bcce-b302099a8059';

function processor(payload: unknown) {
  const handle = vi.fn().mockResolvedValue('linked');
  const autoHandle = vi.fn().mockResolvedValue('marked');
  const outbox = { payloadOf: vi.fn().mockResolvedValue(payload) };
  const instance = new SocialIntakeProcessor(
    { handle } as unknown as InviteIntake,
    { handle: autoHandle } as unknown as AutoAttendanceIntake,
    outbox as unknown as MongoOutboxReader,
  );
  return {
    handle,
    autoHandle,
    instance,
    run: (name: string) => instance.process({ name, data: { outboxEventId: 'evt-1' } } as Job),
  };
}

describe('SocialIntakeProcessor (P6, P5)', () => {
  it('identity.account-confirmed — разобранный payload уходит в InviteIntake', async () => {
    const { handle, autoHandle, run } = processor({ userId: USER, invite: 'k7m2pqx' });
    await expect(run('identity.account-confirmed')).resolves.toBe('linked');
    expect(handle).toHaveBeenCalledWith({ userId: USER, invite: 'K7M2PQX' });
    expect(autoHandle).not.toHaveBeenCalled();
  });

  it('tracks.activity-ready — разобранный payload уходит в AutoAttendanceIntake, InviteIntake не вызван', async () => {
    const event = { activityId: ACTIVITY, uploadId: UPLOAD, userId: USER };
    const { handle, autoHandle, run } = processor(event);
    await expect(run('tracks.activity-ready')).resolves.toBe('marked');
    expect(autoHandle).toHaveBeenCalledWith(event);
    expect(handle).not.toHaveBeenCalled();
  });

  it('payload не по схеме — skipped, обработчики не вызваны', async () => {
    const invite = processor({ userId: 'nope', invite: 'K7M2PQ0' });
    await expect(invite.run('identity.account-confirmed')).resolves.toBe('skipped');
    const ready = processor({ activityId: 'nope' });
    await expect(ready.run('tracks.activity-ready')).resolves.toBe('skipped');
    for (const { handle, autoHandle } of [invite, ready]) {
      expect(handle).not.toHaveBeenCalled();
      expect(autoHandle).not.toHaveBeenCalled();
    }
  });

  it('неизвестное имя задачи — бросок', async () => {
    const { run } = processor({});
    await expect(run('rides.something')).rejects.toThrow(/unknown job/);
    await expect(run('toString')).rejects.toThrow(/unknown job/);
  });

  it('бросок обработчика — лог social.intake_failed с типом и проброс', async () => {
    const { autoHandle, instance, run } = processor({
      activityId: ACTIVITY,
      uploadId: UPLOAD,
      userId: USER,
    });
    autoHandle.mockRejectedValueOnce(new Error('boom'));
    const warn = vi
      .spyOn((instance as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    await expect(run('tracks.activity-ready')).rejects.toThrow('boom');
    expect(warn).toHaveBeenCalledWith(
      'social.intake_failed type=tracks.activity-ready event=evt-1',
    );
  });
});
