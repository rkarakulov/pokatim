import { ModerationRideDetail, RidePage, RideView } from '@pokatim/contracts';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { brokenJpeg, GIF_BYTES, hasGpsIfd, hugePng, twoToneImage } from '../../../test/avatars';
import { createHarness, DAY, type Harness } from '../../../test/harness';
import { bearer, call, gate, retried, untilBlocked } from '../../../test/identity';
import { panel, panelCall, panelCookie } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  authed,
  createRide,
  hideInDb,
  MODERATION,
  report,
  RIDES,
  rider,
  ridesDb,
  type Rider,
  startsIn,
} from '../../../test/rides';
import { heldUpload } from '../../../test/uploads';
import { ImageProcessing, MEDIA_POLICY } from '../media';
import { RideErasure } from './ride-erasure';
import { ridePhotosCollections } from './ride-photos.collection';
import { RidesRepository } from './rides.repository';

/**
 * Фото организатора кофе-райда (ride-photo, ADR-0028, AC1–AC4): приём и обработка, отдача, удаление, сброс
 * модератором, стирание аккаунта. Общие с аватаром слоты приёма и гейт обработки (R2).
 */
let h: Harness;
let organizer: Rider;
let stranger: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  stranger = await rider(h, 's@example.by');
});
afterAll(async () => {
  await h.close();
});

interface Raw {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
  raw: Buffer;
}

const parse = (response: {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  rawPayload: Buffer;
}): Raw => {
  const json = String(response.headers['content-type'] ?? '').startsWith('application/json');
  return {
    status: response.statusCode,
    body: json && response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
    raw: response.rawPayload,
  };
};

async function upload(
  who: Rider | null,
  rideId: string,
  bytes: Buffer,
  contentType = 'application/octet-stream',
): Promise<Raw> {
  return parse(
    await h.app.inject({
      method: 'PUT',
      url: `${RIDES}/${rideId}/photo`,
      headers: { 'content-type': contentType, ...(who ? bearer(who.token) : {}) },
      payload: bytes,
    }),
  );
}

const removePhoto = (who: Rider, rideId: string) =>
  authed(h, who, 'POST', `${RIDES}/${rideId}/photo/delete`, {});

async function fetchPhoto(id: string): Promise<Raw> {
  return parse(await h.app.inject({ method: 'GET', url: `/v1/ride-photos/${id}` }));
}

const photoIdOf = (res: { body: unknown }): string => {
  const id = RideView.parse(res.body).ride.photo?.id;
  if (!id) throw new Error(`нет фото в ${JSON.stringify(res.body)}`);
  return id;
};

/** Райд уже начался — старт в прошлом прямой записью (часы не двигаются: access стенда живёт минуты). */
const makePast = (id: string) =>
  ridesDb(h).updateOne(
    { _id: id },
    { $set: { startsAt: new Date(h.clock.now().getTime() - 3_600_000) } },
  );

const photosDb = () => ridePhotosCollections(h.db).photos;
const photo = (width = 1200, height = 900) => twoToneImage('jpeg', { width, height });

describe('PUT /v1/rides/:id/photo — приём (AC1)', () => {
  it('JPEG с EXIF → 200 RideView с photo.id, version прежний; отдача — JPEG без EXIF/GPS с заголовками (AC2)', async () => {
    const ride = await createRide(h, organizer);
    const input = await twoToneImage('jpeg', { orientation: 6, width: 2000, height: 1000 });
    expect(hasGpsIfd((await sharp(input).metadata()).exif)).toBe(true);
    const res = await upload(organizer, ride.id, input);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const view = RideView.parse(res.body);
    expect(view.ride).toMatchObject({ version: ride.version });
    const id = photoIdOf(res);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const image = await fetchPhoto(id);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('public, max-age=86400, immutable');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    const meta = await sharp(image.raw).metadata();
    // ориентация 6: 2000×1000 → портрет, вписан в 1600 по длинной стороне
    expect(meta).toMatchObject({ format: 'jpeg', width: 800, height: 1600 });
    expect(meta.exif).toBeUndefined();
    expect(image.raw.includes(Buffer.from('PokatimTest'))).toBe(false);

    const stored = await photosDb().findOne({ _id: id });
    expect(stored).toMatchObject({
      rideId: ride.id,
      organizerUserId: organizer.userId,
      contentType: 'image/jpeg',
      width: 800,
      height: 1600,
    });
  });

  it('замена — новый id, прежний URL 404 без immutable; в коллекции один документ', async () => {
    const ride = await createRide(h, organizer);
    const first = photoIdOf(await upload(organizer, ride.id, await photo()));
    const second = photoIdOf(
      await upload(organizer, ride.id, await twoToneImage('png', { width: 900, height: 600 })),
    );
    expect(second).not.toBe(first);
    const old = await fetchPhoto(first);
    expect(old.status).toBe(404);
    expect(old.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(old.headers['cache-control'] ?? '')).not.toContain('immutable');
    expect((await fetchPhoto(second)).status).toBe(200);
    expect(await photosDb().countDocuments()).toBe(1);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.version).toBe(ride.version);
  });

  it('не организатор и неизвестный райд — 404 до тела (Connection: close); без входа — 401', async () => {
    const ride = await createRide(h, organizer);
    const foreign = await upload(stranger, ride.id, await photo());
    expect(foreign.status).toBe(404);
    expect(foreign.headers['connection']).toBe('close');
    const unknown = await upload(organizer, '01890a5d-ac96-774b-bcce-b302099a8057', await photo());
    expect(unknown.status).toBe(404);
    expect((await upload(null, ride.id, await photo())).status).toBe(401);
    expect((await upload(organizer, 'not-a-uuid', await photo())).status).toBe(400);
    expect(await photosDb().countDocuments()).toBe(0);
  });

  it('отменённый, скрытый и прошедший — 409 RIDE_INVALID_STATE до тела', async () => {
    const cancelled = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, { reason: 'weather' });
    const hidden = await createRide(h, organizer);
    await hideInDb(h, hidden.id);
    const past = await createRide(h, organizer);
    await makePast(past.id);
    for (const id of [cancelled.id, hidden.id, past.id]) {
      const res = await upload(organizer, id, await photo());
      expect(res.status, id).toBe(409);
      expect(res.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
      expect(res.headers['connection']).toBe('close');
    }
    expect(await photosDb().countDocuments()).toBe(0);
  });

  it('не изображение — 415 IMAGE_FORMAT_UNSUPPORTED; > 10 МиБ — 413 IMAGE_TOO_LARGE', async () => {
    const ride = await createRide(h, organizer);
    for (const bytes of [GIF_BYTES, Buffer.from('просто текст')]) {
      const res = await upload(organizer, ride.id, bytes);
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ code: 'IMAGE_FORMAT_UNSUPPORTED' });
    }
    const json = await upload(organizer, ride.id, Buffer.from('{}'), 'application/json');
    expect(json.status).toBe(415);
    const large = await upload(organizer, ride.id, Buffer.alloc(10 * 1024 * 1024 + 1, 0xff));
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(large.headers['connection']).toBe('close');
    expect(await photosDb().countDocuments()).toBe(0);
  });

  it('мелкое и панорама — 422 too_small; битое и > 25 Мп PNG — 422 unreadable', async () => {
    const ride = await createRide(h, organizer);
    for (const bytes of [
      await twoToneImage('png', { width: 300, height: 300 }),
      await twoToneImage('jpeg', { width: 8000, height: 400 }),
    ]) {
      const res = await upload(organizer, ride.id, bytes);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'IMAGE_INVALID', details: { reason: 'too_small' } });
    }
    for (const bytes of [brokenJpeg(), hugePng()]) {
      const res = await upload(organizer, ride.id, bytes);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'IMAGE_INVALID', details: { reason: 'unreadable' } });
    }
    expect(await photosDb().countDocuments()).toBe(0);
  });

  it('21-я загрузка за час — 429', async () => {
    const ride = await createRide(h, organizer);
    const png = await twoToneImage('png', { width: 600, height: 400 });
    for (let i = 0; i < 20; i += 1)
      expect((await upload(organizer, ride.id, png)).status).toBe(200);
    const limited = await upload(organizer, ride.id, png);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await photosDb().countDocuments()).toBe(1);
  });

  it('R2: слот приёма общий с аватаром — параллельно аватар и фото одного пользователя — 429 до тела', async () => {
    const ride = await createRide(h, organizer);
    const avatar = heldUpload(h, '/v1/profile/avatar', bearer(organizer.token), 'PUT');
    await avatar.held();
    const busy = await upload(organizer, ride.id, await photo());
    expect(busy.status).toBe(429);
    expect(busy.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 5 } });
    expect((await avatar.finish(await twoToneImage('png'))).status).toBe(200);

    const held = heldUpload(h, `${RIDES}/${ride.id}/photo`, bearer(organizer.token), 'PUT');
    await held.held();
    expect((await upload(organizer, ride.id, await photo())).status).toBe(429);
    expect((await held.finish(await photo())).status).toBe(200);
  });

  it('R2: гейт обработки один на процесс — занят (как аватаром) дольше ожидания → фото 429; освободился — 200', async () => {
    const ride = await createRide(h, organizer);
    const gateOfApp = h.app.get(ImageProcessing, { strict: false });
    expect(gateOfApp).toBeInstanceOf(ImageProcessing);
    const saved = { ...MEDIA_POLICY.processing };
    Object.assign(MEDIA_POLICY.processing, { waitMs: 100 });
    const permit = await gateOfApp.acquire();
    try {
      const busy = await upload(organizer, ride.id, await photo());
      expect(busy.status).toBe(429);
      expect(busy.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 5 } });
      // аватар упирается в тот же гейт
      const avatar = await h.app.inject({
        method: 'PUT',
        url: '/v1/profile/avatar',
        headers: { 'content-type': 'application/octet-stream', ...bearer(organizer.token) },
        payload: await twoToneImage('png'),
      });
      expect(avatar.statusCode).toBe(429);
    } finally {
      permit?.release();
      Object.assign(MEDIA_POLICY.processing, saved);
    }
    expect((await upload(organizer, ride.id, await photo())).status).toBe(200);
  });
});

describe('GET /v1/ride-photos/:id — отдача (AC2)', () => {
  it('скрытый райд — 404 всем; вернули — снова 200; кривой id — 400; неизвестный — 404 JSON', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    const unhide = await hideInDb(h, ride.id);
    const hidden = await fetchPhoto(id);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(hidden.headers['cache-control'] ?? '')).not.toContain('immutable');
    await unhide();
    expect((await fetchPhoto(id)).status).toBe(200);
    expect((await fetchPhoto('not-a-token')).status).toBe(400);
    const unknown = await fetchPhoto('a'.repeat(43));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('photo во view райда', () => {
  it('лента, me и публичная карточка — photo.id; скрытый — null и организатору', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    const feed = RidePage.parse((await authed(h, stranger, 'GET', RIDES)).body);
    expect(feed.items.find((item) => item.id === ride.id)?.photo).toEqual({ id });
    const me = RideView.parse((await authed(h, stranger, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(me.ride.photo).toEqual({ id });
    const pub = await call(h, 'GET', `${RIDES}/${ride.id}`);
    expect(pub.body).toMatchObject({ photo: { id } });

    await hideInDb(h, ride.id);
    const own = RideView.parse((await authed(h, organizer, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(own.ride.phase).toBe('hidden');
    expect(own.ride.photo).toBeNull();
  });

  it('без фото — photo: null', async () => {
    const ride = await createRide(h, organizer);
    const me = RideView.parse((await authed(h, organizer, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(me.ride.photo).toBeNull();
  });
});

describe('POST /v1/rides/:id/photo/delete (AC3)', () => {
  it('своё — 200 photo: null, URL 404, повтор — 200; чужое — 404', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    expect((await removePhoto(stranger, ride.id)).status).toBe(404);
    expect((await fetchPhoto(id)).status).toBe(200);
    const removed = await removePhoto(organizer, ride.id);
    expect(removed.status).toBe(200);
    expect(removed.headers['cache-control']).toBe('no-store');
    expect(RideView.parse(removed.body).ride.photo).toBeNull();
    expect((await fetchPhoto(id)).status).toBe(404);
    const again = await removePhoto(organizer, ride.id);
    expect(again.status).toBe(200);
    expect(RideView.parse(again.body).ride.photo).toBeNull();
    expect(await photosDb().countDocuments()).toBe(0);
    expect((await removePhoto(organizer, '01890a5d-ac96-774b-bcce-b302099a8057')).status).toBe(404);
  });

  it('скрытого и прошедшего — тоже можно', async () => {
    const hidden = await createRide(h, organizer);
    photoIdOf(await upload(organizer, hidden.id, await photo()));
    await hideInDb(h, hidden.id);
    const past = await createRide(h, organizer);
    photoIdOf(await upload(organizer, past.id, await photo()));
    await makePast(past.id);
    for (const id of [hidden.id, past.id]) {
      expect((await removePhoto(organizer, id)).status, id).toBe(200);
      expect((await ridesDb(h).findOne({ _id: id }))?.photoId).toBeNull();
    }
    expect(await photosDb().countDocuments()).toBe(0);
  });
});

describe('сброс модератором (AC3, R10)', () => {
  let moderator: { userId: string; token: string };
  beforeEach(async () => {
    moderator = await staff(h, 'moderator@example.by', 'moderator');
  });
  const reset = (id: string, body: unknown, token = moderator.token) =>
    panelCall(h, token, 'POST', `${MODERATION}/${id}/photo-reset`, body);

  it('с причиной → 200, URL 404, журнал ride.photo_reset без id фото; жалобы и version не тронуты', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    expect((await report(h, stranger, ride.id)).status).toBe(200);
    const card = ModerationRideDetail.parse(
      (await panelCall(h, moderator.token, 'GET', `${MODERATION}/${ride.id}`)).body,
    );
    expect(card.photo).toEqual({ id });

    const res = await reset(ride.id, { photoId: id, reason: 'Чужое фото' });
    expect(res.status).toBe(200);
    const detail = ModerationRideDetail.parse(res.body);
    expect(detail).toMatchObject({ photo: null, openReportCount: 1, version: card.version });
    expect((await fetchPhoto(id)).status).toBe(404);
    expect(await photosDb().countDocuments()).toBe(0);
    const audit = await panel(h).audit.find({ action: 'ride.photo_reset' }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: moderator.userId },
      subject: { kind: 'ride', id: ride.id, label: ride.title },
      reason: 'Чужое фото',
      details: null,
    });
    expect(JSON.stringify(audit[0])).not.toContain(id);
  });

  it('фото уже другое — 409 CONFLICT без журнала; фото нет — 200 без журнала; неизвестный — 404', async () => {
    const ride = await createRide(h, organizer);
    const first = photoIdOf(await upload(organizer, ride.id, await photo()));
    const second = photoIdOf(await upload(organizer, ride.id, await photo()));
    const stale = await reset(ride.id, { photoId: first, reason: 'Чужое фото' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    expect((await fetchPhoto(second)).status).toBe(200);
    await removePhoto(organizer, ride.id);
    const none = await reset(ride.id, { photoId: second, reason: 'Чужое фото' });
    expect(none.status).toBe(200);
    expect(ModerationRideDetail.parse(none.body).photo).toBeNull();
    expect(await panel(h).audit.countDocuments({ action: 'ride.photo_reset' })).toBe(0);
    expect(
      (
        await reset('01890a5d-ac96-774b-bcce-b302099a8057', {
          photoId: second,
          reason: 'Чужое фото',
        })
      ).status,
    ).toBe(404);
  });

  it('скрытый райд: photo в карточке модерации есть, сброс работает', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    await hideInDb(h, ride.id);
    const card = ModerationRideDetail.parse(
      (await panelCall(h, moderator.token, 'GET', `${MODERATION}/${ride.id}`)).body,
    );
    expect(card.photo).toEqual({ id });
    expect((await reset(ride.id, { photoId: id, reason: 'Чужое фото' })).status).toBe(200);
    expect(await photosDb().countDocuments()).toBe(0);
  });

  it('тело строгое (лишний ключ, кривой id) — 400; без rides.moderate — 403; без сессии — 401', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    expect((await reset(ride.id, { photoId: id, reason: 'Чужое фото', version: 0 })).status).toBe(
      400,
    );
    expect((await reset(ride.id, { photoId: 'x', reason: 'Чужое фото' })).status).toBe(400);
    const staffOrganizer = await staff(h, 'staff-org@example.by', 'organizer');
    expect(
      (await reset(ride.id, { photoId: id, reason: 'Чужое фото' }, staffOrganizer.token)).status,
    ).toBe(403);
    expect(
      (await panelCall(h, undefined, 'POST', `${MODERATION}/${ride.id}/photo-reset`, {})).status,
    ).toBe(401);
    expect((await fetchPhoto(id)).status).toBe(200);
  });
});

describe('GET /v1/admin/rides/:id/photo — фото для модерации (ride-photo-followups AC5)', () => {
  let moderator: { userId: string; token: string };
  beforeEach(async () => {
    moderator = await staff(h, 'moderator@example.by', 'moderator');
  });
  const adminPhoto = async (url: string, token: string | null = moderator.token) =>
    parse(await h.app.inject({ method: 'GET', url, headers: token ? panelCookie(token) : {} }));
  const urlOf = (rideId: string, photoId: string) =>
    `${MODERATION}/${rideId}/photo?photoId=${encodeURIComponent(photoId)}`;
  const expectJpeg = (res: Raw) => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  };
  const expectNotFound = (res: Raw) => {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(res.headers['content-type'])).not.toContain('image/jpeg');
  };

  it('видимый и скрытый райд — байты текущего фото, private no-store; публичный GET скрытого — 404', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    const visible = await adminPhoto(urlOf(ride.id, id));
    expectJpeg(visible);
    const pub = await fetchPhoto(id);
    expect(pub.status).toBe(200);
    expect(visible.raw.equals(pub.raw)).toBe(true);

    await hideInDb(h, ride.id);
    expect((await fetchPhoto(id)).status).toBe(404);
    const hidden = await adminPhoto(urlOf(ride.id, id));
    expectJpeg(hidden);
    expect(hidden.raw.equals(pub.raw)).toBe(true);
  });

  it('photoId не текущий / фото нет / райда нет / фото другого райда — 404 JSON', async () => {
    const ride = await createRide(h, organizer);
    const other = await createRide(h, organizer);
    const first = photoIdOf(await upload(organizer, ride.id, await photo()));
    const second = photoIdOf(await upload(organizer, ride.id, await photo()));
    const foreign = photoIdOf(await upload(organizer, other.id, await photo()));
    expectNotFound(await adminPhoto(urlOf(ride.id, first)));
    expectNotFound(await adminPhoto(urlOf(ride.id, foreign)));
    expectNotFound(await adminPhoto(urlOf('01890a5d-ac96-774b-bcce-b302099a8057', second)));
    expectJpeg(await adminPhoto(urlOf(ride.id, second)));
    await removePhoto(organizer, ride.id);
    expectNotFound(await adminPhoto(urlOf(ride.id, second)));
  });

  it('кривой или лишний query, кривой id — 400; без rides.moderate — 403; без сессии — 401', async () => {
    const ride = await createRide(h, organizer);
    const id = photoIdOf(await upload(organizer, ride.id, await photo()));
    expect((await adminPhoto(`${MODERATION}/${ride.id}/photo`)).status).toBe(400);
    expect((await adminPhoto(urlOf(ride.id, 'x'))).status).toBe(400);
    expect((await adminPhoto(`${urlOf(ride.id, id)}&extra=1`)).status).toBe(400);
    expect((await adminPhoto(urlOf('not-a-uuid', id))).status).toBe(400);
    const staffOrganizer = await staff(h, 'staff-org@example.by', 'organizer');
    expect((await adminPhoto(urlOf(ride.id, id), staffOrganizer.token)).status).toBe(403);
    expect((await adminPhoto(urlOf(ride.id, id), null)).status).toBe(401);
  });
});

describe('гонка: замена параллельно со сбросом модератором', () => {
  it('замена записала райд и не закоммитила → сброс упирается (конфликт, повтор) → 409; один согласованный документ', async () => {
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    const ride = await createRide(h, organizer);
    const first = photoIdOf(await upload(organizer, ride.id, await photo()));
    // замена: запись райда прошла внутри транзакции, коммита ещё нет — ворота после `setPhoto`
    const paused = gate();
    const original = RidesRepository.prototype.setPhoto;
    vi.spyOn(RidesRepository.prototype, 'setPhoto').mockImplementationOnce(async function (
      this: RidesRepository,
      ...args: Parameters<RidesRepository['setPhoto']>
    ) {
      const result = await original.apply(this, args);
      await paused.wait();
      return result;
    });
    const resetSpy = vi.spyOn(RidesRepository.prototype, 'resetPhoto');
    const replacing = upload(organizer, ride.id, await photo());
    await paused.reached;
    // сброс по прежнему фото: запись того же документа райда — конфликт с незакоммиченной заменой, повтор транзакции
    const resetting = panelCall(
      h,
      moderator.token,
      'POST',
      `${MODERATION}/${ride.id}/photo-reset`,
      {
        photoId: first,
        reason: 'Чужое фото',
      },
    );
    await untilBlocked(resetting, retried(resetSpy));
    paused.open();
    const [replaced, reset] = await Promise.all([replacing, resetting]);
    vi.restoreAllMocks();
    expect(replaced.status).toBe(200);
    const fresh = photoIdOf(replaced);
    // повтор сброса видит новое фото: модератор его не видел — 409, журнала нет
    expect(reset.status).toBe(409);
    expect(reset.body).toMatchObject({ code: 'CONFLICT' });
    expect(await panel(h).audit.countDocuments({ action: 'ride.photo_reset' })).toBe(0);
    const docs = await photosDb().find({ rideId: ride.id }).toArray();
    expect(docs.map((doc) => doc._id)).toEqual([fresh]);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.photoId).toBe(fresh);
    expect((await fetchPhoto(fresh)).status).toBe(200);
    expect((await fetchPhoto(first)).status).toBe(404);
  });
});

describe('стирание аккаунта (AC4)', () => {
  it('фото организатора (в т. ч. скрытого и прошедшего райда) удалены, photoId: null; чужие целы; повтор — no-op', async () => {
    const hidden = await createRide(h, organizer);
    const hiddenPhoto = photoIdOf(await upload(organizer, hidden.id, await photo()));
    const past = await createRide(h, organizer);
    photoIdOf(await upload(organizer, past.id, await photo()));
    const future = await createRide(h, organizer, { startsAt: startsIn(h, 3 * DAY) });
    photoIdOf(await upload(organizer, future.id, await photo()));
    const foreignRide = await createRide(h, stranger);
    const foreign = photoIdOf(await upload(stranger, foreignRide.id, await photo()));
    await hideInDb(h, hidden.id);
    h.clock.advance(DAY + 3_600_000);

    const erasure = h.app.get(RideErasure, { strict: false });
    const result = await erasure.erase(organizer.userId, h.clock.now());
    expect(result.photos).toBe(3);
    expect(await photosDb().countDocuments({ organizerUserId: organizer.userId })).toBe(0);
    for (const id of [hidden.id, past.id, future.id]) {
      expect((await ridesDb(h).findOne({ _id: id }))?.photoId ?? null, id).toBeNull();
    }
    expect((await fetchPhoto(hiddenPhoto)).status).toBe(404);
    expect(await photosDb().countDocuments({ _id: foreign })).toBe(1);
    expect((await ridesDb(h).findOne({ _id: foreignRide.id }))?.photoId).toBe(foreign);

    const again = await erasure.erase(organizer.userId, h.clock.now());
    expect(again.photos).toBe(0);
    expect(await photosDb().countDocuments({ _id: foreign })).toBe(1);
  });
});
