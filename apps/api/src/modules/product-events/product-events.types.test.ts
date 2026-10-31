import { describe, expect, it } from 'vitest';

import { PRODUCT_EVENT_TYPES, ProductEventInput } from './product-events.types';

const USER = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('справочник продуктовых событий (K12, ADR-0027 п. 7)', () => {
  const valid = [
    { type: 'connection-created', userId: USER, props: { source: 'manual' } },
    { type: 'ride-joined', userId: USER, props: { source: 'social_home' } },
    { type: 'attendance-marked', userId: USER, props: { via: 'track' } },
    { type: 'thanks-sent', userId: USER, props: {} },
    { type: 'respect-sent', userId: USER, props: { targetType: 'route' } },
    { type: 'invite-registered', userId: USER, props: {} },
    { type: 'name-published', userId: USER, props: {} },
    { type: 'active-day', userId: USER, props: { day: '2026-10-31' } },
  ];

  it('каждый тип K12 проходит; состав справочника — в порядке K12', () => {
    expect(valid.map((event) => ProductEventInput.parse(event).type)).toEqual([
      ...PRODUCT_EVENT_TYPES,
    ]);
  });

  it('неизвестный тип, лишнее поле в props и чужой userId в props отвергаются (RC-12)', () => {
    expect(ProductEventInput.safeParse({ type: 'opened', userId: USER, props: {} }).success).toBe(
      false,
    );
    expect(
      ProductEventInput.safeParse({
        type: 'thanks-sent',
        userId: USER,
        props: { recipientId: USER },
      }).success,
    ).toBe(false);
    expect(
      ProductEventInput.safeParse({
        type: 'connection-created',
        userId: USER,
        props: { source: 'manual', otherId: USER },
      }).success,
    ).toBe(false);
    expect(
      ProductEventInput.safeParse({
        type: 'respect-sent',
        userId: USER,
        props: { targetType: 'ride_rider' },
      }).success,
    ).toBe(false);
    expect(
      ProductEventInput.safeParse({ type: 'thanks-sent', userId: 'nope', props: {} }).success,
    ).toBe(false);
  });
});
