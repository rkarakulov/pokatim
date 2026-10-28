import { ProfileView, type Session } from '@pokatim/contracts';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  avatarPixel,
  brokenJpeg,
  GIF_BYTES,
  hasGpsIfd,
  hugePng,
  twoToneImage,
} from '../../../test/avatars';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';
import { heldUpload } from '../../../test/uploads';
import { PROFILE_COLLECTIONS } from './profile.collection';
import { PROFILE_POLICY } from './profile.policy';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const AVATAR = '/v1/profile/avatar';

interface Raw {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
  raw: Buffer;
}

async function upload(
  session: Session | null,
  bytes: Buffer,
  { query = '', contentType = 'application/octet-stream' } = {},
): Promise<Raw> {
  const response = await h.app.inject({
    method: 'PUT',
    url: `${AVATAR}${query}`,
    headers: {
      'content-type': contentType,
      ...(session ? bearer(session.accessToken) : {}),
    },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
    raw: response.rawPayload,
  };
}

async function fetchAvatar(id: string): Promise<Raw> {
  const response = await h.app.inject({ method: 'GET', url: `/v1/avatars/${id}` });
  const json = response.headers['content-type']?.toString().startsWith('application/json');
  return {
    status: response.statusCode,
    body: json ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
    raw: response.rawPayload,
  };
}

const avatarIdOf = (res: Raw): string => {
  const id = ProfileView.parse(res.body).avatar?.id;
  if (!id) throw new Error(`no avatar in ${JSON.stringify(res.body)}`);
  return id;
};
const avatars = () => h.db.collection(PROFILE_COLLECTIONS.avatars);

describe('PUT /v1/profile/avatar — приём и обработка (AC1)', () => {
  it('JPEG с EXIF (GPS, ориентация 6) → 200; GET отдаёт 512×512 JPEG без EXIF, развёрнутый, с заголовками', async () => {
    const session = await signUpSession(h);
    const input = await twoToneImage('jpeg', { orientation: 6 });
    // во входе действительно есть GPS и производитель (LOW-3 ревью)
    expect(hasGpsIfd((await sharp(input).metadata()).exif)).toBe(true);
    expect(input.includes(Buffer.from('PokatimTest'))).toBe(true);
    const res = await upload(session, input);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const id = avatarIdOf(res);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const image = await fetchAvatar(id);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    const meta = await sharp(image.raw).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // в байтах нет ни производителя, ни GPS
    expect(image.raw.includes(Buffer.from('PokatimTest'))).toBe(false);
    // ориентация 6: левая (красная) половина — сверху
    expect(await avatarPixel(image.raw, 256, 40)).toBe('red');
    expect(await avatarPixel(image.raw, 256, 470)).toBe('blue');

    // GET /v1/profile — тот же аватар
    const profile = await call(h, 'GET', '/v1/profile', undefined, bearer(session.accessToken));
    expect(profile.body).toMatchObject({ avatar: { id } });
  });

  it('обрезка по query — заданный квадрат; без query — центр', async () => {
    const session = await signUpSession(h);
    const right = await upload(session, await twoToneImage('jpeg'), {
      query: '?x=0.5&y=0&size=1',
    });
    expect(right.status).toBe(200);
    const blue = await fetchAvatar(avatarIdOf(right));
    expect(await avatarPixel(blue.raw, 20, 256)).toBe('blue');
    expect(await avatarPixel(blue.raw, 490, 256)).toBe('blue');

    const center = await upload(session, await twoToneImage('jpeg'));
    const half = await fetchAvatar(avatarIdOf(center));
    expect(await avatarPixel(half.raw, 60, 256)).toBe('red');
    expect(await avatarPixel(half.raw, 450, 256)).toBe('blue');
  });

  it('query не по контракту — 400 до тела; мелкая обрезка — 422', async () => {
    const session = await signUpSession(h);
    const partial = await upload(session, await twoToneImage('jpeg'), { query: '?x=0.5' });
    expect(partial.status).toBe(400);
    expect(partial.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const tiny = await upload(session, await twoToneImage('jpeg'), {
      query: '?x=0&y=0&size=0.1',
    });
    expect(tiny.status).toBe(422);
    expect(tiny.body).toMatchObject({ code: 'AVATAR_INVALID' });
    expect(await avatars().countDocuments()).toBe(0);
  });
});

describe('ошибки загрузки (AC2)', () => {
  it('PNG и WebP принимаются', async () => {
    const session = await signUpSession(h);
    expect((await upload(session, await twoToneImage('png'))).status).toBe(200);
    expect((await upload(session, await twoToneImage('webp'))).status).toBe(200);
  });

  it('GIF, текст, не octet-stream — 415; > 10 МиБ — 413 с Connection: close', async () => {
    const session = await signUpSession(h);
    const gif = await upload(session, GIF_BYTES);
    expect(gif.status).toBe(415);
    expect(gif.body).toMatchObject({ code: 'AVATAR_FORMAT_UNSUPPORTED' });
    const text = await upload(session, Buffer.from('просто текст, не фото'));
    expect(text.status).toBe(415);
    expect(text.body).toMatchObject({ code: 'AVATAR_FORMAT_UNSUPPORTED' });
    const json = await upload(session, Buffer.from('{"a":1}'), { contentType: 'application/json' });
    expect(json.status).toBe(415);

    const large = await upload(session, Buffer.alloc(10 * 1024 * 1024 + 1, 0xff));
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ code: 'AVATAR_TOO_LARGE' });
    expect(large.headers['connection']).toBe('close');
    expect(await avatars().countDocuments()).toBe(0);
  });

  it('больше 25 Мп и битый файл — 422; без входа — 401', async () => {
    const session = await signUpSession(h);
    const huge = await upload(session, hugePng());
    expect(huge.status).toBe(422);
    expect(huge.body).toMatchObject({ code: 'AVATAR_INVALID' });
    const broken = await upload(session, brokenJpeg());
    expect(broken.status).toBe(422);
    expect(broken.body).toMatchObject({ code: 'AVATAR_INVALID' });
    expect((await upload(null, await twoToneImage('jpeg'))).status).toBe(401);
  });

  it('21-я загрузка за час — 429', async () => {
    const session = await signUpSession(h);
    const png = await twoToneImage('png');
    for (let i = 0; i < 20; i += 1) expect((await upload(session, png)).status).toBe(200);
    const limited = await upload(session, png);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await avatars().countDocuments()).toBe(1);
  });

  it('второй одновременный приём того же пользователя — 429 до тела', async () => {
    const session = await signUpSession(h);
    const first = heldUpload(h, AVATAR, bearer(session.accessToken), 'PUT');
    await first.held();
    const second = await upload(session, await twoToneImage('png'));
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 5 } });
    expect((await first.finish(await twoToneImage('png'))).status).toBe(200);
    expect((await upload(session, await twoToneImage('png'))).status).toBe(200);
  });

  it('MEDIUM-1 ревью: один приём аватара на процесс — другой пользователь получает 429, пока первый держит слот', async () => {
    const first = await signUpSession(h, 'first@example.com');
    const second = await signUpSession(h, 'second@example.com');
    const held = heldUpload(h, AVATAR, bearer(first.accessToken), 'PUT');
    await held.held();
    const refused = await upload(second, await twoToneImage('png'));
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 5 } });
    expect((await held.finish(await twoToneImage('png'))).status).toBe(200);
    expect((await upload(second, await twoToneImage('png'))).status).toBe(200);
  });

  it('LOW-1 ревью: отказ «слот занят» не списывает часовую квоту', async () => {
    const session = await signUpSession(h);
    const png = await twoToneImage('png');
    const held = heldUpload(h, AVATAR, bearer(session.accessToken), 'PUT');
    await held.held();
    for (let i = 0; i < 5; i += 1) expect((await upload(session, png)).status).toBe(429);
    expect((await held.finish(png)).status).toBe(200);
    // квота 20/ч: 1 принятая + 19 — без 5 отказов по слоту
    for (let i = 0; i < 19; i += 1) expect((await upload(session, png)).status).toBe(200);
    expect((await upload(session, png)).status).toBe(429);
  });

  it('MEDIUM-2 ревью: свои короткие таймауты тела (10 с тишины, 60 с всего); тишина — 408 и Connection: close', async () => {
    expect(PROFILE_POLICY.avatarBodyTimeouts).toEqual({ idleMs: 10_000, totalMs: 60_000 });
    const saved = { ...PROFILE_POLICY.avatarBodyTimeouts };
    Object.assign(PROFILE_POLICY.avatarBodyTimeouts, { idleMs: 200 });
    const session = await signUpSession(h);
    try {
      const silent = heldUpload(h, AVATAR, bearer(session.accessToken), 'PUT');
      await silent.held();
      silent.write((await twoToneImage('png')).subarray(0, 100));
      const timedOut = await silent.response;
      expect(timedOut.status).toBe(408);
      expect(timedOut.headers['connection']).toBe('close');
      expect(timedOut.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ path: 'body', code: 'INVALID' }] },
      });
    } finally {
      Object.assign(PROFILE_POLICY.avatarBodyTimeouts, saved);
    }
    expect(await avatars().countDocuments()).toBe(0);
    expect((await upload(session, await twoToneImage('png'))).status).toBe(200);
  });
});

describe('замена и удаление (AC3)', () => {
  it('замена удаляет прежний: старый id → 404 без immutable; в коллекции один документ', async () => {
    const session = await signUpSession(h);
    const first = avatarIdOf(await upload(session, await twoToneImage('png')));
    const second = avatarIdOf(await upload(session, await twoToneImage('jpeg')));
    expect(second).not.toBe(first);
    const old = await fetchAvatar(first);
    expect(old.status).toBe(404);
    expect(old.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(old.headers['cache-control'] ?? '')).not.toContain('immutable');
    expect((await fetchAvatar(second)).status).toBe(200);
    expect(await avatars().countDocuments()).toBe(1);
  });

  it('POST …/delete → avatar: null, повтор — 200; аватар — 404; без входа — 401', async () => {
    const session = await signUpSession(h);
    const id = avatarIdOf(await upload(session, await twoToneImage('png')));
    const auth = bearer(session.accessToken);
    const removed = await call(h, 'POST', `${AVATAR}/delete`, undefined, auth);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ avatar: null });
    expect((await fetchAvatar(id)).status).toBe(404);
    const again = await call(h, 'POST', `${AVATAR}/delete`, undefined, auth);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ avatar: null });
    expect(await avatars().countDocuments()).toBe(0);
    expect((await call(h, 'POST', `${AVATAR}/delete`)).status).toBe(401);
  });

  it('удаление без профиля — 200 с пустым профилем', async () => {
    const session = await signUpSession(h);
    const res = await call(h, 'POST', `${AVATAR}/delete`, undefined, bearer(session.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ avatar: null, publicName: null });
  });

  it('GET /v1/avatars/:id — мусорный id → 400, неизвестный → 404', async () => {
    expect((await fetchAvatar('not-a-token')).status).toBe(400);
    expect((await fetchAvatar('a'.repeat(43))).status).toBe(404);
  });
});
