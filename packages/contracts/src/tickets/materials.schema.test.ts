import { describe, expect, it } from 'vitest';

import {
  EVENT_MATERIAL_TYPES,
  EventMaterial,
  EventMaterialFileId,
  EventMaterialInput,
  EventMaterialUploadQuery,
  materialContentIssues,
  ReorderEventMaterialsRequest,
  UpdateEventMaterialRequest,
} from './materials.schema.ts';
import { TICKETING_INVALID_STATE_REASONS } from './ticketing-admin.schema.ts';
import { TicketView } from './ticket.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const FILE_ID = 'a'.repeat(43);

/** Поля с ошибками (без повторов: одно поле может дать несколько проверок). */
const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => [
  ...new Set(result.error?.issues.map((issue) => issue.path.join('.')) ?? []),
];

describe('материалы события (event-tickets PR C)', () => {
  it('справочник типов — только в конец', () => {
    expect(EVENT_MATERIAL_TYPES).toEqual([
      'rules',
      'what_to_bring',
      'clothing',
      'route',
      'safety',
      'gpx',
      'parking',
      'start_procedure',
      'nutrition',
      'weather',
      'pdf',
      'link',
      'text',
    ]);
    expect(TICKETING_INVALID_STATE_REASONS).toEqual([
      'start_time_required',
      'capacity_below_registered',
      'event_cancelled',
      'materials_limit',
      'files_limit',
    ]);
  });

  it('правила содержимого (RC-C5): ссылка, файл или только текст', () => {
    const rule = (
      type: (typeof EVENT_MATERIAL_TYPES)[number],
      content: { url?: string | null; description?: string | null; hasFile?: boolean },
    ) =>
      materialContentIssues({
        type,
        url: content.url ?? null,
        description: content.description ?? null,
        hasFile: content.hasFile ?? false,
      });
    expect(rule('link', { url: 'https://a.by' })).toEqual([]);
    expect(rule('link', {})).toEqual([{ path: 'url', code: 'REQUIRED' }]);
    expect(rule('gpx', { hasFile: true })).toEqual([{ path: 'type', code: 'INVALID' }]);
    expect(rule('link', { url: 'https://a.by', hasFile: true })).toEqual([
      { path: 'type', code: 'INVALID' },
    ]);
    expect(rule('text', { description: 'x', hasFile: true })).toEqual([
      { path: 'type', code: 'INVALID' },
    ]);
    expect(rule('text', { description: 'Сбор в 9:00' })).toEqual([]);
    expect(rule('text', {})).toEqual([{ path: 'description', code: 'REQUIRED' }]);
    expect(rule('text', { url: 'https://a.by', description: 'x' })).toEqual([
      { path: 'url', code: 'INVALID' },
    ]);
    expect(rule('pdf', { hasFile: true })).toEqual([]);
    expect(rule('pdf', { url: 'https://a.by' })).toEqual([{ path: 'type', code: 'INVALID' }]);
    expect(rule('rules', { url: 'https://a.by' })).toEqual([]);
    expect(rule('rules', { hasFile: true, description: 'кратко' })).toEqual([]);
    expect(rule('rules', { description: 'Только текст' })).toEqual([]);
    expect(rule('rules', {})).toEqual([{ path: 'description', code: 'REQUIRED' }]);
    expect(rule('parking', { url: 'https://a.by', hasFile: true })).toEqual([
      { path: 'url', code: 'INVALID' },
    ]);
  });

  it('EventMaterialInput: https без учётных данных, обрезка, pdf через JSON — нельзя', () => {
    const ok = EventMaterialInput.parse({
      type: 'link',
      title: '  Положение  ',
      description: '',
      url: 'https://pokatim.by/rules',
    });
    expect(ok).toEqual({
      type: 'link',
      title: 'Положение',
      description: null,
      url: 'https://pokatim.by/rules',
    });
    const base = { type: 'link', title: 'Ссылка', description: null };
    expect(issuesOf(EventMaterialInput.safeParse({ ...base, url: 'http://a.by' }))).toEqual([
      'url',
    ]);
    expect(issuesOf(EventMaterialInput.safeParse({ ...base, url: 'https://user:p@a.by' }))).toEqual(
      ['url'],
    );
    expect(issuesOf(EventMaterialInput.safeParse({ ...base, url: null }))).toEqual(['url']);
    expect(
      issuesOf(
        EventMaterialInput.safeParse({ type: 'pdf', title: 'PDF', description: null, url: null }),
      ),
    ).toEqual(['type']);
    expect(
      issuesOf(
        EventMaterialInput.safeParse({ type: 'text', title: 'T', description: null, url: null }),
      ),
    ).toEqual(['description']);
    expect(issuesOf(EventMaterialInput.safeParse({ ...base, url: 'https://a.by', x: 1 }))).toEqual([
      '',
    ]);
    expect(
      issuesOf(EventMaterialInput.safeParse({ ...base, title: 'a\u0007', url: 'https://a.by' })),
    ).toEqual(['title']);
    expect(
      issuesOf(
        EventMaterialInput.safeParse({ ...base, title: 'x'.repeat(121), url: 'https://a.by' }),
      ),
    ).toEqual(['title']);
  });

  it('UpdateEventMaterialRequest — частичная правка с версией; загрузка — без link/gpx/text', () => {
    expect(UpdateEventMaterialRequest.parse({ title: 'Новое', version: 2 })).toEqual({
      title: 'Новое',
      version: 2,
    });
    expect(UpdateEventMaterialRequest.safeParse({ title: 'Новое' }).success).toBe(false);
    expect(
      EventMaterialUploadQuery.parse({ type: 'pdf', title: 'Положение', fileName: 'rules.pdf' }),
    ).toEqual({ type: 'pdf', title: 'Положение', fileName: 'rules.pdf' });
    for (const type of ['link', 'gpx', 'text']) {
      expect(
        issuesOf(EventMaterialUploadQuery.safeParse({ type, title: 'x', fileName: 'a.pdf' })),
      ).toEqual(['type']);
    }
  });

  it('порядок — без повторов, 1–20 id', () => {
    expect(ReorderEventMaterialsRequest.parse({ ids: [ID] })).toEqual({ ids: [ID] });
    expect(ReorderEventMaterialsRequest.safeParse({ ids: [ID, ID] }).success).toBe(false);
    expect(ReorderEventMaterialsRequest.safeParse({ ids: [] }).success).toBe(false);
  });

  it('ответ приложения: незнакомый тип — unknown; id файла — 43 символа; TicketView без materials — ок', () => {
    const material = {
      id: ID,
      type: 'weather_v2',
      title: 'Погода',
      description: null,
      url: null,
      file: { id: FILE_ID, name: 'w.pdf', size: 10 },
    };
    expect(EventMaterial.parse(material).type).toBe('unknown');
    expect(EventMaterialFileId.safeParse(FILE_ID).success).toBe(true);
    expect(EventMaterialFileId.safeParse(`${FILE_ID}a`).success).toBe(false);
    const view = {
      code: '7XK2M9PQRT',
      status: 'active',
      past: false,
      event: {
        kind: 'race',
        id: ID,
        title: 'Кольцо',
        startsAt: '2026-10-24T07:00:00.000Z',
        endsAt: null,
        place: null,
        address: null,
        city: null,
      },
      participantName: 'Участник',
      category: null,
      qr: null,
      instructions: null,
      checkedInAt: null,
    };
    expect(TicketView.parse(view).materials).toBeUndefined();
    expect(TicketView.parse({ ...view, materials: [material] }).materials?.[0]?.type).toBe(
      'unknown',
    );
  });
});
