import {
  type AuditAction,
  EventMaterial,
  EventMaterialAdmin,
  EventMaterialsAdmin,
  type EventMaterialUploadQuery,
} from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, gate } from '../../../test/identity';
import { memberUser, panel, panelCall, panelCookie, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import { calendarStart, raceWorld, ticketingUrl } from '../../../test/tickets';
import { type EventMaterialDoc, materialsCollections } from './materials.collection';
import { MaterialsRepository } from './materials.repository';

/**
 * Материалы события (event-tickets PR C, AC9): права на каждую ручку (RC-T9), CRUD, порядок, версия, правила RC-C5,
 * лимиты 20/10, журнал, загрузка PDF (сигнатура, 10 МиБ), отдача файла (заголовки RC-C3), публичный список (RC-C9).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'latin1');
const LINK = { type: 'link', title: 'Положение', description: null, url: 'https://pokatim.by/r' };
const TEXT = { type: 'text', title: 'Сбор', description: 'В 9:00 у арки', url: null };

const url = (kind: 'race' | 'calendar', id: string, path = '') =>
  `${ticketingUrl(kind, id, 'materials')}${path}`;

async function world() {
  const { admin, raceId } = await raceWorld(h);
  const organizerId = await memberUser(h, 'org@example.by', 'organizer');
  await memberUser(h, 'org2@example.by', 'organizer');
  await memberUser(h, 'mod@example.by', 'moderator');
  await racesDb(h).races.updateOne({ _id: raceId }, { $set: { ownerUserId: organizerId } });
  const calendarId = await calendarStart(h, admin.token);
  return {
    raceId,
    calendarId,
    organizerId,
    tokens: {
      admin: admin.token,
      organizer: await panelSession(h, 'org@example.by'),
      other: await panelSession(h, 'org2@example.by'),
      moderator: await panelSession(h, 'mod@example.by'),
    },
  };
}

async function upload(
  token: string | undefined,
  target: string,
  bytes: Buffer,
  query: Partial<Record<keyof EventMaterialUploadQuery, string>> = {},
  contentType = 'application/octet-stream',
) {
  const search = new URLSearchParams({
    type: 'rules',
    title: 'Положение гонки',
    fileName: 'Правила "o\'k".pdf',
    ...query,
  });
  const response = await h.app.inject({
    method: 'POST',
    url: `${target}/files?${search.toString()}`,
    headers: { 'content-type': contentType, ...(token ? panelCookie(token) : {}) },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
  };
}

const create = async (token: string, target: string, body: unknown) => {
  const res = await panelCall(h, token, 'POST', target, body);
  if (res.status !== 201) throw new Error(`материал: ${res.status} ${JSON.stringify(res.body)}`);
  return EventMaterialAdmin.parse(res.body);
};

const audit = (action: AuditAction) => panel(h).audit.find({ action }).toArray();

describe('права (RC-T9): каждая ручка', () => {
  it('модератор — 403, чужой организатор — 404, организатор + календарь — 403, гость — 401, admin — 200', async () => {
    const w = await world();
    const own = await create(w.tokens.organizer, url('race', w.raceId), LINK);
    const routes = (kind: 'race' | 'calendar', id: string) =>
      [
        ['GET', url(kind, id), undefined],
        ['POST', url(kind, id), LINK],
        ['PATCH', url(kind, id, `/${own.id}`), { title: 'Иное', version: 1 }],
        ['POST', url(kind, id, `/${own.id}/delete`), undefined],
        ['PUT', url(kind, id, '/order'), { ids: [own.id] }],
      ] as const;
    for (const [method, target, body] of routes('race', w.raceId)) {
      const label = `${method} ${target}`;
      expect((await panelCall(h, w.tokens.moderator, method, target, body)).status, label).toBe(
        403,
      );
      expect((await panelCall(h, w.tokens.other, method, target, body)).status, label).toBe(404);
      expect((await panelCall(h, undefined, method, target, body)).status, label).toBe(401);
    }
    for (const [method, target, body] of routes('calendar', w.calendarId)) {
      expect(
        (await panelCall(h, w.tokens.organizer, method, target, body)).status,
        `${method} ${target}`,
      ).toBe(403);
    }
    expect((await upload(w.tokens.moderator, url('race', w.raceId), PDF)).status).toBe(403);
    expect((await upload(w.tokens.other, url('race', w.raceId), PDF)).status).toBe(404);
    expect((await upload(w.tokens.organizer, url('calendar', w.calendarId), PDF)).status).toBe(403);
    expect((await panelCall(h, w.tokens.admin, 'GET', url('calendar', w.calendarId))).status).toBe(
      200,
    );
    expect((await panelCall(h, w.tokens.admin, 'GET', url('race', w.raceId))).status).toBe(200);
  });

  it('материал чужого события по id — 404 (фильтр с kind, eventId)', async () => {
    const w = await world();
    const onCalendar = await create(w.tokens.admin, url('calendar', w.calendarId), LINK);
    const target = url('race', w.raceId, `/${onCalendar.id}`);
    expect(
      (await panelCall(h, w.tokens.admin, 'PATCH', target, { title: 'x', version: 1 })).status,
    ).toBe(404);
    expect((await panelCall(h, w.tokens.admin, 'POST', `${target}/delete`)).status).toBe(404);
    const doc = await materialsCollections(h.db).materials.findOne({ _id: onCalendar.id });
    expect(doc?.title).toBe('Положение');
  });
});

describe('CRUD, порядок, журнал (RC-C7, RC-C8)', () => {
  it('создание, правка с версией, порядок полным набором, удаление; журнал по каждой мутации', async () => {
    const w = await world();
    const target = url('race', w.raceId);
    const a = await create(w.tokens.organizer, target, LINK);
    const b = await create(w.tokens.organizer, target, TEXT);
    expect(a).toMatchObject({ ...LINK, version: 1, file: null });

    const listed = EventMaterialsAdmin.parse(
      (await panelCall(h, w.tokens.organizer, 'GET', target)).body,
    );
    expect(listed.items.map((item) => item.id)).toEqual([a.id, b.id]);
    expect(listed).toMatchObject({ itemsLeft: 18, filesLeft: 10 });

    const edited = await panelCall(
      h,
      w.tokens.organizer,
      'PATCH',
      url('race', w.raceId, `/${a.id}`),
      {
        title: 'Положение 2026',
        version: 1,
      },
    );
    expect(edited.status).toBe(200);
    expect(EventMaterialAdmin.parse(edited.body)).toMatchObject({
      title: 'Положение 2026',
      version: 2,
    });
    const stale = await panelCall(
      h,
      w.tokens.organizer,
      'PATCH',
      url('race', w.raceId, `/${a.id}`),
      {
        title: 'Опять',
        version: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    // без изменений — без записи и журнала
    await panelCall(h, w.tokens.organizer, 'PATCH', url('race', w.raceId, `/${a.id}`), {
      title: 'Положение 2026',
      version: 2,
    });

    const partial = await panelCall(h, w.tokens.organizer, 'PUT', url('race', w.raceId, '/order'), {
      ids: [b.id],
    });
    expect(partial.status).toBe(409);
    const reordered = await panelCall(
      h,
      w.tokens.organizer,
      'PUT',
      url('race', w.raceId, '/order'),
      {
        ids: [b.id, a.id],
      },
    );
    expect(reordered.status).toBe(200);
    expect(EventMaterialsAdmin.parse(reordered.body).items.map((item) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
    // новый — в конец
    const c = await create(w.tokens.organizer, target, { ...LINK, title: 'Ещё' });
    const removed = await panelCall(
      h,
      w.tokens.organizer,
      'POST',
      url('race', w.raceId, `/${b.id}/delete`),
    );
    expect(removed.status).toBe(204);
    expect(
      (await panelCall(h, w.tokens.organizer, 'POST', url('race', w.raceId, `/${b.id}/delete`)))
        .status,
    ).toBe(404);
    const after = EventMaterialsAdmin.parse(
      (await panelCall(h, w.tokens.organizer, 'GET', target)).body,
    );
    expect(after.items.map((item) => item.id)).toEqual([a.id, c.id]);

    const subject = { kind: 'race', id: w.raceId, label: 'Минское кольцо' };
    expect(await audit('tickets.material_added')).toHaveLength(3);
    expect((await audit('tickets.material_added'))[0]).toMatchObject({
      actor: { kind: 'user', userId: w.organizerId },
      subject,
    });
    const updated = await audit('tickets.material_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ subject, details: { changedFields: ['title'] } });
    expect(await audit('tickets.materials_reordered')).toHaveLength(1);
    expect(await audit('tickets.material_removed')).toHaveLength(1);
  });

  it('правила содержимого (RC-C5) — 400 по полям, в т. ч. итог правки', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    const bad = [
      [{ ...LINK, url: 'http://pokatim.by' }, 'url'],
      [{ ...LINK, url: 'https://user:p@pokatim.by' }, 'url'],
      [{ ...LINK, url: null }, 'url'],
      [{ ...TEXT, description: null }, 'description'],
      [{ ...TEXT, url: 'https://pokatim.by' }, 'url'],
      [{ type: 'pdf', title: 'PDF', description: null, url: null }, 'type'],
    ] as const;
    for (const [body, field] of bad) {
      const res = await panelCall(h, w.tokens.admin, 'POST', target, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(res.body)).toContain(`"path":"${field}"`);
    }
    const text = await create(w.tokens.admin, target, TEXT);
    const toLink = await panelCall(
      h,
      w.tokens.admin,
      'PATCH',
      url('calendar', w.calendarId, `/${text.id}`),
      {
        type: 'link',
        version: 1,
      },
    );
    expect(toLink.status).toBe(400);
    expect(JSON.stringify(toLink.body)).toContain('"path":"url"');
  });

  it('лимит 20 материалов → 409 materials_limit', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    const docs = Array.from({ length: 20 }, (_, order) => ({
      _id: `00000000-0000-7000-8000-${String(order).padStart(12, '0')}`,
      kind: 'calendar' as const,
      eventId: w.calendarId,
      type: 'text' as const,
      title: `Т${order}`,
      description: 'x',
      url: null,
      file: null,
      order,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: w.organizerId,
    }));
    await materialsCollections(h.db).materials.insertMany(docs);
    const res = await panelCall(h, w.tokens.admin, 'POST', target, LINK);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'TICKETING_INVALID_STATE',
      details: { reason: 'materials_limit' },
    });
    expect((await upload(w.tokens.admin, target, PDF)).body).toMatchObject({
      details: { reason: 'materials_limit' },
    });
  });

  it('параллельное добавление на границе лимита: 19 + 3 POST → один 201, остальные 409 materials_limit', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    const docs = Array.from({ length: 19 }, (_, order) => ({
      _id: `00000000-0000-7000-8000-${String(order).padStart(12, '0')}`,
      kind: 'calendar' as const,
      eventId: w.calendarId,
      type: 'text' as const,
      title: `Т${order}`,
      description: 'x',
      url: null,
      file: null,
      order,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: w.organizerId,
    }));
    await materialsCollections(h.db).materials.insertMany(docs);
    const results = await Promise.all(
      [0, 1, 2].map(() => panelCall(h, w.tokens.admin, 'POST', target, LINK)),
    );
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409]);
    for (const res of results.filter((item) => item.status === 409)) {
      expect(res.body).toMatchObject({
        code: 'TICKETING_INVALID_STATE',
        details: { reason: 'materials_limit' },
      });
    }
    expect(
      await materialsCollections(h.db).materials.countDocuments({ eventId: w.calendarId }),
    ).toBe(20);
    expect(await audit('tickets.material_added')).toHaveLength(1);
  });
});

/**
 * Write skew лимитов (ревью PR C pass 4): добавление A прочитало материалы и стоит перед вставкой; перестановка B
 * уплотняет порядок, добавление C занимает освободившуюся позицию — без общего замка события A вставляет сверх лимита.
 * Ворота — пауза первого чтения материалов в транзакции; B, затем C либо завершаются, либо ждут замка (тогда A
 * открывается через 2 с).
 */
describe('лимиты под замком события: добавление, перестановка, добавление', () => {
  /** Материалы события с порядком 1..count (позиция 0 свободна — как после удаления первого), первые `files` — PDF. */
  async function seed(eventId: string, updatedBy: string, count: number, files = 0) {
    const docs: EventMaterialDoc[] = Array.from({ length: count }, (_, index) => ({
      _id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
      kind: 'calendar',
      eventId,
      type: 'text',
      title: `Т${index}`,
      description: 'x',
      url: null,
      file: index < files ? { id: `file-${index}`, name: 'a.pdf', size: 1 } : null,
      order: index + 1,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy,
    }));
    await materialsCollections(h.db).materials.insertMany(docs);
    return docs.map((doc) => doc._id);
  }

  function pauseFirstRead() {
    const g = gate();
    const repository = h.app.get(MaterialsRepository, { strict: false });
    const original = repository.listOf.bind(repository);
    let paused = false;
    vi.spyOn(repository, 'listOf').mockImplementation(async (kind, eventId, session) => {
      const docs = await original(kind, eventId, session);
      if (session && !paused) {
        paused = true;
        await g.wait();
      }
      return docs;
    });
    return g;
  }

  async function race(
    token: string,
    target: string,
    ids: string[],
    add: () => Promise<{ status: number; body: unknown }>,
  ) {
    const g = pauseFirstRead();
    const first = add();
    await g.reached;
    // B, затем C (C должен увидеть уплотнённый порядок)
    const rest = (async () => {
      const b = await panelCall(h, token, 'PUT', `${target}/order`, { ids: [...ids].reverse() });
      return [b, await add()] as const;
    })();
    await Promise.race([rest, new Promise((resolve) => setTimeout(resolve, 2000))]);
    g.open();
    const [a, [b, c]] = await Promise.all([first, rest]);
    return { a, b, c };
  }

  it('19 материалов: A, перестановка, C → ровно 20, один 409 materials_limit', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    const ids = await seed(w.calendarId, w.organizerId, 19);
    const { a, b, c } = await race(w.tokens.admin, target, ids, () =>
      panelCall(h, w.tokens.admin, 'POST', target, LINK),
    );
    expect(
      await materialsCollections(h.db).materials.countDocuments({ eventId: w.calendarId }),
    ).toBe(20);
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    expect(c).toMatchObject({
      status: 409,
      body: { code: 'TICKETING_INVALID_STATE', details: { reason: 'materials_limit' } },
    });
  });

  it('9 PDF из 15: загрузка A, перестановка, загрузка C → ровно 10 PDF, один 409 files_limit', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    const ids = await seed(w.calendarId, w.organizerId, 15, 9);
    const { a, b, c } = await race(w.tokens.admin, target, ids, () =>
      upload(w.tokens.admin, target, PDF),
    );
    expect(
      await materialsCollections(h.db).materials.countDocuments({
        eventId: w.calendarId,
        file: { $ne: null },
      }),
    ).toBe(10);
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    expect(c).toMatchObject({
      status: 409,
      body: { code: 'TICKETING_INVALID_STATE', details: { reason: 'files_limit' } },
    });
  });
});

describe('загрузка и отдача PDF (RC-C3, RC-C6)', () => {
  it('PDF → 201, файл с заголовками; удаление материала → файл 404', async () => {
    const w = await world();
    const target = url('race', w.raceId);
    const res = await upload(w.tokens.organizer, target, PDF, {
      description: 'Кратко',
      fileName: 'Правила "o\'k".pdf',
    });
    expect(res.status).toBe(201);
    const material = EventMaterialAdmin.parse(res.body);
    expect(material).toMatchObject({
      type: 'rules',
      title: 'Положение гонки',
      description: 'Кратко',
      url: null,
      file: { name: "Правила _o'k_.pdf", size: PDF.byteLength },
    });
    expect(material.file?.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await audit('tickets.material_added')).toHaveLength(1);

    const file = await h.app.inject({ method: 'GET', url: `/v1/event-files/${material.file?.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PDF)).toBe(true);
    expect(file.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-length': String(PDF.byteLength),
      'content-disposition': `attachment; filename="material.pdf"; filename*=UTF-8''%D0%9F%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%B0%20_o%27k_.pdf`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
    });

    await panelCall(h, w.tokens.organizer, 'POST', url('race', w.raceId, `/${material.id}/delete`));
    const gone = await call(h, 'GET', `/v1/event-files/${material.file?.id}`);
    expect(gone.status).toBe(404);
    expect(String(gone.headers['cache-control'])).not.toContain('immutable');
    expect(await materialsCollections(h.db).files.countDocuments()).toBe(0);
  });

  it('не PDF по сигнатуре — 415; text/plain — 415; 10 МиБ + 1 — 413 и Connection: close', async () => {
    const w = await world();
    const target = url('race', w.raceId);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    for (const bytes of [png, Buffer.from('<html>%PDF-1.7</html>')]) {
      const res = await upload(w.tokens.organizer, target, bytes);
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ code: 'MATERIAL_FILE_UNSUPPORTED' });
    }
    expect((await upload(w.tokens.organizer, target, PDF, {}, 'text/plain')).status).toBe(415);
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 + 1 - PDF.byteLength)]);
    const tooLarge = await upload(w.tokens.organizer, target, big);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toMatchObject({ code: 'MATERIAL_FILE_TOO_LARGE' });
    expect(tooLarge.headers.connection).toBe('close');
    expect(await materialsCollections(h.db).materials.countDocuments()).toBe(0);
    expect(await materialsCollections(h.db).files.countDocuments()).toBe(0);
  });

  it('лимит 10 PDF → 409 files_limit; лимит загрузок 30/ч → 429 до чтения тела', async () => {
    const w = await world();
    const target = url('calendar', w.calendarId);
    for (let i = 0; i < 10; i += 1) {
      expect((await upload(w.tokens.admin, target, PDF, { title: `PDF ${i}` })).status).toBe(201);
    }
    const eleventh = await upload(w.tokens.admin, target, PDF);
    expect(eleventh.status).toBe(409);
    expect(eleventh.body).toMatchObject({ details: { reason: 'files_limit' } });
    const list = EventMaterialsAdmin.parse(
      (await panelCall(h, w.tokens.admin, 'GET', target)).body,
    );
    expect(list).toMatchObject({ filesLeft: 0, itemsLeft: 10 });

    for (let i = 11; i < 30; i += 1) await upload(w.tokens.admin, target, Buffer.from('x'));
    const limited = await upload(w.tokens.admin, target, PDF);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('неизвестный или кривой id файла — 404 JSON без immutable', async () => {
    for (const id of ['A'.repeat(43), 'bad', `${'A'.repeat(43)}x`]) {
      const res = await call(h, 'GET', `/v1/event-files/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(String(res.headers['cache-control'] ?? '')).not.toContain('immutable');
    }
  });
});

describe('публичный список (RC-C9)', () => {
  it('порядок, явный набор ключей, public-кэш; без включённых билетов — отдаётся', async () => {
    const w = await world();
    const target = url('race', w.raceId);
    await create(w.tokens.admin, target, LINK);
    await upload(w.tokens.admin, target, PDF);
    const res = await call(h, 'GET', `/v1/events/race/${w.raceId}/materials`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const items = (res.body as unknown[]).map((item) => EventMaterial.parse(item));
    expect(items.map((item) => item.title)).toEqual(['Положение', 'Положение гонки']);
    for (const item of res.body as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual([
        'description',
        'file',
        'id',
        'title',
        'type',
        'url',
      ]);
    }
  });

  it('снятый старт календаря и черновик гонки — 404; пустой — []', async () => {
    const w = await world();
    expect((await call(h, 'GET', `/v1/events/calendar/${w.calendarId}/materials`)).body).toEqual(
      [],
    );
    const start = await panelCall(h, w.tokens.admin, 'GET', `/v1/admin/calendar/${w.calendarId}`);
    await panelCall(h, w.tokens.admin, 'POST', `/v1/admin/calendar/${w.calendarId}/unpublish`, {
      reason: 'Перенос',
      version: (start.body as { version: number }).version,
    });
    expect((await call(h, 'GET', `/v1/events/calendar/${w.calendarId}/materials`)).status).toBe(
      404,
    );
    await racesDb(h).races.updateOne({ _id: w.raceId }, { $set: { status: 'draft' } });
    expect((await call(h, 'GET', `/v1/events/race/${w.raceId}/materials`)).status).toBe(404);
    expect(
      (await call(h, 'GET', `/v1/events/race/00000000-0000-7000-8000-000000000000/materials`))
        .status,
    ).toBe(404);
  });
});
