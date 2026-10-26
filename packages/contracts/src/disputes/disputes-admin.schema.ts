import { z } from 'zod';

import { MULTI_LINE, optionalText, PageQuery, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import { RACE_RESULT_STATUSES } from '../results/results.schema.ts';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_DECISION_TEMPLATES,
  DISPUTE_EVENT_KINDS,
  DISPUTE_OUTCOMES,
  DISPUTE_STATUSES,
  DISPUTE_TEMPLATES_BY_OUTCOME,
} from './disputes.schema.ts';

/*
 * Споры в панели «Протокол» (race-results-06, права `disputes.read` / `disputes.decide`). Панель деплоится вместе с
 * API — строгие `z.enum`. Заявитель и участник — по `userId`/`entryId` (A12).
 */

/** Почему решение недоступно (`PanelDispute.decideBlockedBy`). */
export const DISPUTE_DECIDE_BLOCKS = [
  'too_early',
  'not_open',
  'protocol_published',
  'cancelled',
] as const;
export type DisputeDecideBlock = (typeof DISPUTE_DECIDE_BLOCKS)[number];

export const DISPUTE_NOTE_MAX = 1000;

/** `POST /v1/admin/disputes/:disputeId/decision`: шаблон — из карты исхода; заметка — только команде. */
export const DisputeDecisionRequest = z
  .strictObject({
    outcome: z.enum(DISPUTE_OUTCOMES),
    template: z.enum(DISPUTE_DECISION_TEMPLATES),
    note: optionalText(DISPUTE_NOTE_MAX, MULTI_LINE).optional(),
  })
  .superRefine((value, ctx) => {
    const allowed: readonly string[] = DISPUTE_TEMPLATES_BY_OUTCOME[value.outcome];
    if (!allowed.includes(value.template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'INVALID' });
    }
  });
export type DisputeDecisionRequest = z.infer<typeof DisputeDecisionRequest>;

/** `GET /v1/admin/disputes?status&raceId&cursor&limit` — по `filedAt` убыв., курсор — `id` последней строки. */
export const PanelDisputeQuery = z.strictObject({
  ...PageQuery.shape,
  status: z.enum(DISPUTE_STATUSES).optional(),
  raceId: Uuid.optional(),
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PanelDisputeQuery = z.infer<typeof PanelDisputeQuery>;

export const PanelDisputeListItem = z.object({
  id: Uuid,
  race: z.object({ id: Uuid, title: z.string() }),
  status: z.enum(DISPUTE_STATUSES),
  category: z.enum(DISPUTE_CATEGORIES),
  targetEntryId: Uuid,
  complainantEntryId: Uuid,
  filedAt: z.iso.datetime(),
  decidableAt: z.iso.datetime(),
  responded: z.boolean(),
});
export type PanelDisputeListItem = z.infer<typeof PanelDisputeListItem>;

export const PanelDisputePage = z.object({
  items: z.array(PanelDisputeListItem),
  nextCursor: PageCursor.nullable(),
});
export type PanelDisputePage = z.infer<typeof PanelDisputePage>;

/** Разбор спора: заявление, ответ участника, оспоренный результат, история и решение. */
export const PanelDispute = PanelDisputeListItem.extend({
  description: z.string().nullable(),
  response: z.object({ text: z.string(), at: z.iso.datetime() }).nullable(),
  target: z.object({
    entryId: Uuid,
    userId: Uuid,
    resultStatus: z.enum(RACE_RESULT_STATUSES),
    place: z.number().int().nullable(),
    tied: z.boolean(),
    elapsedSec: z.number().int().nullable(),
  }),
  complainant: z.object({ entryId: Uuid, userId: Uuid }),
  decision: z
    .object({
      outcome: z.enum(DISPUTE_OUTCOMES),
      template: z.enum(DISPUTE_DECISION_TEMPLATES),
      note: z.string().nullable(),
      actor: z.object({ userId: Uuid, displayName: z.string() }),
      at: z.iso.datetime(),
    })
    .nullable(),
  events: z.array(
    z.object({
      kind: z.enum(DISPUTE_EVENT_KINDS),
      actorKind: z.enum(['rider', 'staff']),
      at: z.iso.datetime(),
    }),
  ),
  filingClosesAt: z.iso.datetime(),
  protocolPlannedAt: z.iso.datetime(),
  canDecide: z.boolean(),
  decideBlockedBy: z.enum(DISPUTE_DECIDE_BLOCKS).nullable(),
});
export type PanelDispute = z.infer<typeof PanelDispute>;
