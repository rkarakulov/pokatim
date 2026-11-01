import { describe, expect, it } from 'vitest';

import type { PublicRiderCard } from '../profile';
import { NEUTRAL_RESPECT, respectStateView } from './respect.view';

const cards = new Map<string, PublicRiderCard>([
  ['a', { name: 'Аня', publicId: 'pub-a', avatarId: 'av-a' }],
  ['b', { name: 'Боря', publicId: null, avatarId: null }],
]);
// `c` — без публичной карточки (нет имени или согласия): только числом
const target = { recipientId: 'owner' };

describe('respectStateView (P4, K8, K3)', () => {
  it('нет цели — нейтральное состояние', () => {
    expect(
      respectStateView({
        target: null,
        viewerId: 'x',
        count: 5,
        respected: true,
        actorIds: ['a'],
        cards,
      }),
    ).toEqual(NEUTRAL_RESPECT);
    expect(NEUTRAL_RESPECT).toEqual({
      available: false,
      respected: false,
      count: 0,
      own: false,
      from: null,
    });
  });

  it('зритель не получатель — available, без `from`', () => {
    expect(
      respectStateView({ target, viewerId: 'v', count: 2, respected: true, actorIds: [], cards }),
    ).toEqual({ available: true, respected: true, count: 2, own: false, from: null });
  });

  it('получатель — own, `from`: публичные строками в порядке, без карточки и сверх лимита — числом', () => {
    const view = respectStateView({
      target,
      viewerId: 'owner',
      count: 4,
      respected: false,
      actorIds: ['a', 'b', 'c'],
      cards,
    });
    expect(view).toEqual({
      available: false,
      respected: false,
      count: 4,
      own: true,
      from: {
        riders: [
          { name: 'Аня', publicId: 'pub-a', avatar: { id: 'av-a' } },
          { name: 'Боря', publicId: null, avatar: null },
        ],
        hiddenCount: 2,
      },
    });
    expect(JSON.stringify(view)).not.toContain('owner');
  });

  it('получатель без респектов — `from` пустой', () => {
    expect(
      respectStateView({
        target,
        viewerId: 'owner',
        count: 0,
        respected: false,
        actorIds: [],
        cards,
      }).from,
    ).toEqual({ riders: [], hiddenCount: 0 });
  });
});
