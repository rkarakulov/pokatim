import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../common.ts';
import {
  DISPUTE_DECIDE_BLOCKS,
  DisputeDecisionRequest,
  PanelDispute,
  PanelDisputePage,
  PanelDisputeQuery,
} from './disputes-admin.schema.ts';
import {
  DISPUTE_ACTION_BLOCKS,
  DISPUTE_CATEGORIES,
  DISPUTE_DECISION_TEMPLATES,
  DISPUTE_EVENT_KINDS,
  DISPUTE_FILE_BLOCKS,
  DISPUTE_FILING_STATUSES,
  DISPUTE_STATUSES,
  DISPUTE_TEMPLATES_BY_OUTCOME,
  DisputeActionBlockedDetails,
  DisputeFileRequest,
  DisputeResponseRequest,
  MyRaceDisputes,
} from './disputes.schema.ts';

const ID = '01900000-0000-7000-8000-000000000001';
const ID2 = '01900000-0000-7000-8000-000000000002';
const AT = '2026-10-27T10:00:00.000Z';

function codes(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('справочники споров — состав и порядок (только в конец)', () => {
  it('категории, статусы, шаблоны, события', () => {
    expect(DISPUTE_CATEGORIES).toEqual([
      'speed_vs_heart_rate',
      'heart_rate_doubtful',
      'vehicle_assistance',
      'foreign_track',
      'other',
    ]);
    expect(DISPUTE_STATUSES).toEqual(['open', 'withdrawn', 'upheld', 'rejected']);
    expect(DISPUTE_DECISION_TEMPLATES).toEqual([
      'speed_implausible',
      'vehicle_assistance',
      'foreign_track',
      'rules_violation',
      'track_confirmed',
      'insufficient_evidence',
      'not_a_violation',
    ]);
    expect(DISPUTE_TEMPLATES_BY_OUTCOME).toEqual({
      upheld: ['speed_implausible', 'vehicle_assistance', 'foreign_track', 'rules_violation'],
      rejected: ['track_confirmed', 'insufficient_evidence', 'not_a_violation'],
    });
    expect(DISPUTE_EVENT_KINDS).toEqual(['filed', 'responded', 'withdrawn', 'decided']);
    expect(DISPUTE_FILING_STATUSES).toEqual(['open', 'closed', 'unavailable']);
  });

  it('причины блокировок (RC-10): подача ⊂ действия', () => {
    expect(DISPUTE_FILE_BLOCKS).toEqual([
      'not_entered',
      'withdrawn',
      'no_counted_result',
      'disqualified',
      'cancelled',
      'protocol_published',
      'filing_closed',
      'open_limit',
    ]);
    expect(DISPUTE_ACTION_BLOCKS).toEqual([
      ...DISPUTE_FILE_BLOCKS,
      'own_result',
      'target_not_counted',
      'already_filed',
      'not_open',
      'already_responded',
      'too_early',
    ]);
    expect(DISPUTE_DECIDE_BLOCKS).toEqual([
      'too_early',
      'not_open',
      'protocol_published',
      'cancelled',
    ]);
  });

  it('коды ошибок — в конце ErrorCode', () => {
    expect(ErrorCode.options.slice(-2)).toEqual(['DISPUTE_ACTION_BLOCKED', 'DISPUTE_NOT_FOUND']);
  });
});

describe('запросы приложения — строгие', () => {
  it('подача: категория обязательна, пустое описание — null, лишние ключи — ошибка', () => {
    expect(DisputeFileRequest.parse({ targetEntryId: ID, category: 'other' })).toEqual({
      targetEntryId: ID,
      category: 'other',
    });
    expect(
      DisputeFileRequest.parse({ targetEntryId: ID, category: 'other', description: '   ' }),
    ).toEqual({ targetEntryId: ID, category: 'other', description: null });
    expect(codes(DisputeFileRequest.safeParse({ targetEntryId: ID }))).toEqual([
      'category:REQUIRED',
    ]);
    expect(DisputeFileRequest.safeParse({ targetEntryId: ID, category: 'unknown' }).success).toBe(
      false,
    );
    expect(
      DisputeFileRequest.safeParse({ targetEntryId: ID, category: 'other', userId: ID2 }).success,
    ).toBe(false);
    expect(DisputeFileRequest.safeParse({ targetEntryId: 'x', category: 'other' }).success).toBe(
      false,
    );
  });

  it('подача: описание ≤ 2000, переводы строки можно, управляющие — нет', () => {
    expect(
      DisputeFileRequest.parse({ targetEntryId: ID, category: 'other', description: 'а\nб' })
        .description,
    ).toBe('а\nб');
    expect(
      codes(
        DisputeFileRequest.safeParse({
          targetEntryId: ID,
          category: 'other',
          description: 'x'.repeat(2001),
        }),
      ),
    ).toEqual(['description:TOO_LONG']);
    expect(
      codes(
        DisputeFileRequest.safeParse({
          targetEntryId: ID,
          category: 'other',
          description: 'a\u0007b',
        }),
      ),
    ).toEqual(['description:INVALID']);
  });

  it('ответ: 3–2000 символов после обрезки, без управляющих', () => {
    expect(DisputeResponseRequest.parse({ text: '  Мой заезд  ' })).toEqual({ text: 'Мой заезд' });
    expect(codes(DisputeResponseRequest.safeParse({ text: ' аб ' }))).toEqual(['text:TOO_SHORT']);
    expect(codes(DisputeResponseRequest.safeParse({ text: 'x'.repeat(2001) }))).toEqual([
      'text:TOO_LONG',
    ]);
    expect(codes(DisputeResponseRequest.safeParse({ text: 'abc\u0000' }))).toEqual([
      'text:INVALID',
    ]);
    expect(DisputeResponseRequest.safeParse({ text: 'abc', extra: 1 }).success).toBe(false);
  });
});

describe('ответы приложения — tolerantEnum (R6)', () => {
  const decision = { outcome: 'upheld', template: 'speed_implausible', at: AT };

  it('MyRaceDisputes: незнакомые значения — unknown', () => {
    const parsed = MyRaceDisputes.parse({
      raceId: ID,
      filing: {
        status: 'paused',
        closesAt: AT,
        protocolPlannedAt: AT,
        reason: 'brand_new',
      },
      filed: [
        {
          id: ID,
          raceId: ID,
          targetEntryId: ID2,
          category: 'teleport',
          description: null,
          status: 'escalated',
          filedAt: AT,
          closedAt: null,
          decision: { ...decision, outcome: 'partly', template: 'new_template' },
        },
      ],
      against: [
        {
          id: ID2,
          raceId: ID,
          category: 'other',
          status: 'open',
          filedAt: AT,
          decidableBy: AT,
          response: null,
          canRespond: true,
          decision: null,
        },
      ],
    });
    expect(parsed.filing.status).toBe('unknown');
    expect(parsed.filing.reason).toBe('unknown');
    expect(parsed.filed[0]?.category).toBe('unknown');
    expect(parsed.filed[0]?.status).toBe('unknown');
    expect(parsed.filed[0]?.decision).toEqual({ outcome: 'unknown', template: 'unknown', at: AT });
  });

  it('DisputeAgainstMe — без заявителя и описания (D-51): лишние ключи отбрасываются', () => {
    const parsed = MyRaceDisputes.parse({
      raceId: ID,
      filing: { status: 'open', closesAt: AT, protocolPlannedAt: AT, reason: null },
      filed: [],
      against: [
        {
          id: ID2,
          raceId: ID,
          category: 'other',
          status: 'open',
          filedAt: AT,
          decidableBy: AT,
          response: { text: 'Это мой трек', at: AT },
          canRespond: false,
          decision: null,
          description: 'секрет',
          complainantUserId: ID,
        },
      ],
    });
    expect(Object.keys(parsed.against[0] ?? {})).not.toContain('description');
    expect(Object.keys(parsed.against[0] ?? {})).not.toContain('complainantUserId');
  });

  it('детали 409: причина терпит новое значение, availableAt — опционально', () => {
    expect(DisputeActionBlockedDetails.parse({ reason: 'too_early', availableAt: AT })).toEqual({
      reason: 'too_early',
      availableAt: AT,
    });
    expect(DisputeActionBlockedDetails.parse({ reason: 'later' }).reason).toBe('unknown');
  });
});

describe('панель — строгие enum', () => {
  it('решение: шаблон из карты исхода (superRefine), заметка ≤ 1000, пустая — null', () => {
    expect(
      DisputeDecisionRequest.parse({ outcome: 'upheld', template: 'vehicle_assistance', note: '' }),
    ).toEqual({ outcome: 'upheld', template: 'vehicle_assistance', note: null });
    expect(
      codes(DisputeDecisionRequest.safeParse({ outcome: 'upheld', template: 'track_confirmed' })),
    ).toEqual(['template:INVALID']);
    expect(
      codes(
        DisputeDecisionRequest.safeParse({ outcome: 'rejected', template: 'speed_implausible' }),
      ),
    ).toEqual(['template:INVALID']);
    expect(
      codes(
        DisputeDecisionRequest.safeParse({
          outcome: 'rejected',
          template: 'not_a_violation',
          note: 'x'.repeat(1001),
        }),
      ),
    ).toEqual(['note:TOO_LONG']);
    expect(
      DisputeDecisionRequest.safeParse({ outcome: 'withdrawn', template: 'not_a_violation' })
        .success,
    ).toBe(false);
    expect(
      DisputeDecisionRequest.safeParse({
        outcome: 'rejected',
        template: 'not_a_violation',
        actorUserId: ID,
      }).success,
    ).toBe(false);
  });

  it('запрос списка: статус и гонка необязательны, limit по умолчанию 50, лишние ключи — ошибка', () => {
    expect(PanelDisputeQuery.parse({})).toMatchObject({ limit: 50 });
    expect(PanelDisputeQuery.parse({ status: 'open', raceId: ID, limit: '10' })).toMatchObject({
      status: 'open',
      raceId: ID,
      limit: 10,
    });
    expect(PanelDisputeQuery.safeParse({ status: 'closed' }).success).toBe(false);
    expect(PanelDisputeQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(PanelDisputeQuery.safeParse({ 'status[$ne]': 'open' }).success).toBe(false);
  });

  it('разбор и страница — строгие', () => {
    const item = {
      id: ID,
      race: { id: ID2, title: 'Гонка' },
      status: 'open',
      category: 'other',
      targetEntryId: ID,
      complainantEntryId: ID2,
      filedAt: AT,
      decidableAt: AT,
      responded: false,
    };
    expect(PanelDisputePage.parse({ items: [item], nextCursor: null }).items).toHaveLength(1);
    expect(
      PanelDisputePage.safeParse({ items: [{ ...item, status: 'new' }], nextCursor: null }).success,
    ).toBe(false);
    const dispute = {
      ...item,
      description: null,
      response: null,
      target: {
        entryId: ID,
        userId: ID2,
        resultStatus: 'provisional',
        place: 1,
        tied: false,
        elapsedSec: 3600,
      },
      complainant: { entryId: ID2, userId: ID },
      decision: null,
      events: [{ kind: 'filed', actorKind: 'rider', at: AT }],
      filingClosesAt: AT,
      protocolPlannedAt: AT,
      canDecide: false,
      decideBlockedBy: 'too_early',
    };
    expect(PanelDispute.parse(dispute).decideBlockedBy).toBe('too_early');
    expect(PanelDispute.safeParse({ ...dispute, decideBlockedBy: 'later' }).success).toBe(false);
  });
});
