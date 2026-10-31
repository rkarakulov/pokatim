import type { LonLat } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { STORY_CARD_POLICY } from './sharing.policy';
import type { StoryCardInput } from './story-card.inputs';
import { renderStoryCard } from './story-card.png';

const input: StoryCardInput = {
  template: 'night',
  themeId: 'atlas',
  riderName: 'Анна',
  address: 'pokatim.by/i/K7M2PQX',
  facts: {
    entryId: 'entry',
    race: {
      title: 'Минская сотка',
      windowStartsAt: new Date('2026-10-03T21:00:00Z'),
      windowEndsAt: new Date('2026-10-12T20:59:00Z'),
      routeId: null,
    },
    status: 'final',
    provisional: false,
    elapsedSec: 9_754,
    place: 3,
    tied: false,
    group: 'overall',
    attempt: null,
  },
};

/** Петля ≈ 1000 точек — больше лимита `trackMaxPoints` (упрощается). */
const loop: LonLat[] = Array.from({ length: 1000 }, (_, i) => {
  const a = (i / 999) * 2 * Math.PI;
  return [27.55 + 0.1 * Math.cos(a), 53.9 + 0.05 * Math.sin(a)];
});

describe('PNG карточки', () => {
  it('сигнатура PNG, IHDR 1080×1920, размер ≤ maxPngBytes', async () => {
    const png = await renderStoryCard(input, loop);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
    expect(png.byteLength).toBeLessThanOrEqual(STORY_CARD_POLICY.maxPngBytes);
  });
});
