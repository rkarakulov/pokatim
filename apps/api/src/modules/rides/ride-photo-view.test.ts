import { describe, expect, it } from 'vitest';

import { ridePhotoOf } from './rides-feed.service';

const ID = 'Ab0_-'.repeat(8) + 'xyz';

describe('ridePhotoOf — фото во view райда (ride-photo)', () => {
  it('есть фото — только id; нет — null; поля нет (старый документ) — null', () => {
    expect(ridePhotoOf({ status: 'published', photoId: ID })).toEqual({ id: ID });
    expect(ridePhotoOf({ status: 'cancelled', photoId: ID })).toEqual({ id: ID });
    expect(ridePhotoOf({ status: 'published', photoId: null })).toBeNull();
    expect(ridePhotoOf({ status: 'published' })).toBeNull();
  });

  it('скрытый райд — null всем (как 404 отдачи)', () => {
    expect(ridePhotoOf({ status: 'hidden', photoId: ID })).toBeNull();
  });
});
