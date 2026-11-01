import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RidesForSharing } from '../rides';
import type { InviteCardBinding, StoryCardCache } from './story-card.cache';
import { StoryCardImageService } from './story-card-image.service';

/** Отдача PNG карточки по токену (ride-photo-followups AC3): приглашение с привязкой — только пока картинка актуальна. */
const TOKEN = 'a'.repeat(22);
const RIDE = '0190a6f4-0000-7000-8000-000000000001';
const PNG = Buffer.from('png');

function setup(options: {
  png?: Buffer | null;
  binding?: InviteCardBinding | 'invalid' | null;
  live?: boolean;
}) {
  const cache = {
    png: vi.fn(async () => (options.png === undefined ? PNG : options.png)),
    binding: vi.fn(async () => options.binding ?? null),
    revoke: vi.fn(async () => undefined),
  };
  const rides = { inviteCardLive: vi.fn(async () => options.live ?? true) };
  const service = new StoryCardImageService(
    cache as unknown as StoryCardCache,
    rides as unknown as RidesForSharing,
  );
  return { service, cache, rides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StoryCardImageService.png', () => {
  it('нет PNG — null, привязка и порт не читаются', async () => {
    const { service, cache, rides } = setup({ png: null });
    expect(await service.png(TOKEN)).toBeNull();
    expect(cache.binding).not.toHaveBeenCalled();
    expect(rides.inviteCardLive).not.toHaveBeenCalled();
  });

  it('без привязки (сторис гонки, достижение, маршрут; приглашения до выката) — PNG, порт не зовётся', async () => {
    const { service, rides } = setup({ binding: null });
    expect(await service.png(TOKEN)).toBe(PNG);
    expect(rides.inviteCardLive).not.toHaveBeenCalled();
  });

  it('привязка жива — PNG; порт получает id райда и фото', async () => {
    const binding = { rideId: RIDE, photoId: 'p'.repeat(43) };
    const { service, cache, rides } = setup({ binding, live: true });
    expect(await service.png(TOKEN)).toBe(PNG);
    expect(rides.inviteCardLive).toHaveBeenCalledWith(RIDE, binding.photoId);
    expect(cache.revoke).not.toHaveBeenCalled();
  });

  it('привязка без фото (line, night без фото) — порт с photoId null', async () => {
    const { service, rides } = setup({ binding: { rideId: RIDE, photoId: null } });
    expect(await service.png(TOKEN)).toBe(PNG);
    expect(rides.inviteCardLive).toHaveBeenCalledWith(RIDE, null);
  });

  it('не жива (скрыт, фото другое) — revoke и null; лог без токена и id фото', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const binding = { rideId: RIDE, photoId: 'p'.repeat(43) };
    const { service, cache } = setup({ binding, live: false });
    expect(await service.png(TOKEN)).toBeNull();
    expect(cache.revoke).toHaveBeenCalledWith(TOKEN);
    const lines = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(lines).toContain(`story-card revoked ride=${RIDE}`);
    expect(lines).not.toContain(TOKEN);
    expect(lines).not.toContain(binding.photoId);
  });

  it('привязка не разбирается — отказ (fail closed), порт не зовётся', async () => {
    const { service, rides } = setup({ binding: 'invalid' });
    expect(await service.png(TOKEN)).toBeNull();
    expect(rides.inviteCardLive).not.toHaveBeenCalled();
  });
});
