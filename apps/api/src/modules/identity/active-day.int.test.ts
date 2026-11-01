import { Logger } from '@nestjs/common';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, HOUR, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { memberUser, panelCall, panelSession } from '../../../test/panel';
import { signIn } from '../../../test/results';
import { rider } from '../../../test/rides';
import { socialDb } from '../../../test/social';
import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';
import { ACTIVE_DAY_WAIT_MS, activeDayKey } from './active-day';

/**
 * Активный день (K12, P7, AC7): первый авторизованный запрос райдера за сутки по Минску — одно `active-day { day }`;
 * повтор в те же сутки — нет; новые сутки — снова. Публичные и панельные ручки — без события. Сбой журнала и Redis
 * запрос не роняют и не держат дольше `ACTIVE_DAY_WAIT_MS`. Стенд: 2026-10-22 09:00Z = 12:00 по Минску.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const activeDays = () => socialDb(h).events.find({ type: 'active-day' }).toArray();
const profile = (token: string) => call(h, 'GET', '/v1/profile', undefined, bearer(token));

function warnings(): string[] {
  const lines: string[] = [];
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
    lines.push(String(message));
  });
  return lines;
}

describe('active-day (AC7)', () => {
  it('первый запрос за сутки — одно событие; второй — нет; следующие сутки по Минску — новое', async () => {
    const who = await rider(h, 'a@example.by');
    // регистрация и вход сами под `AuthGuard` не проходят
    expect(await activeDays()).toEqual([]);
    expect((await profile(who.token)).status).toBe(200);
    expect((await profile(who.token)).status).toBe(200);
    expect(await activeDays()).toMatchObject([
      { type: 'active-day', userId: who.userId, props: { day: '2026-10-22' } },
    ]);

    // 20:59Z — ещё 22-е по Минску; 21:00Z — уже 23-е (вход заново: access старше 15 мин истёк)
    const fresh = await rider(h, 'b@example.by');
    h.clock.advance(11 * HOUR + 59 * 60_000);
    const token = (await signIn(h, 'b@example.by')).authorization!.replace('Bearer ', '');
    expect((await profile(token)).status).toBe(200);
    h.clock.advance(60_000);
    expect((await profile(token)).status).toBe(200);
    expect((await activeDays()).filter((e) => e.userId === fresh.userId)).toMatchObject([
      { props: { day: '2026-10-22' } },
      { props: { day: '2026-10-23' } },
    ]);
  });

  it('публичное чтение и панель — без события', async () => {
    expect((await call(h, 'GET', '/v1/races')).status).toBe(200);
    await memberUser(h, 'admin@example.by', 'admin');
    const token = await panelSession(h, 'admin@example.by');
    expect((await panelCall(h, token, 'GET', '/v1/admin/overview')).status).toBe(200);
    expect(await activeDays()).toEqual([]);
  });

  it('сбой журнала — 200, лог без uid, ключ снят: следующий запрос пишет', async () => {
    const who = await rider(h, 'a@example.by');
    const events = h.app.get<ProductEvents>(PRODUCT_EVENTS, { strict: false });
    const record = events.record.bind(events);
    vi.spyOn(events, 'record').mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const lines = warnings();
    expect((await profile(who.token)).status).toBe(200);
    expect(lines).toContain('product_events.record_failed type=active-day error=Error');
    expect(lines.join('\n')).not.toContain(who.userId);
    expect(await activeDays()).toEqual([]);
    const redis = h.app.get<Redis>(REDIS, { strict: false });
    expect(await redis.exists(activeDayKey(who.userId, '2026-10-22'))).toBe(0);

    vi.mocked(events.record).mockImplementation(record);
    expect((await profile(who.token)).status).toBe(200);
    expect(await activeDays()).toHaveLength(1);
  });

  it('Redis завис — ответ не ждёт дольше ~200 мс, 200; Redis бросает — 200 и лог', async () => {
    const who = await rider(h, 'a@example.by');
    const redis = h.app.get<Redis>(REDIS, { strict: false });
    const set = vi
      .spyOn(redis, 'set')
      .mockImplementation(() => new Promise(() => undefined) as never);
    const started = performance.now();
    expect((await profile(who.token)).status).toBe(200);
    // запас на нагрузку стенда: ожидание отметки ограничено, остальной запрос — обычный
    expect(performance.now() - started).toBeLessThan(ACTIVE_DAY_WAIT_MS + 1500);

    set.mockImplementation(() => Promise.reject(new Error('down')) as never);
    const lines = warnings();
    expect((await profile(who.token)).status).toBe(200);
    expect(lines).toContain('product_events.record_failed type=active-day error=Error');
    expect(await activeDays()).toEqual([]);
  });
});
