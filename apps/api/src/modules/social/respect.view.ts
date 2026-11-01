import type { RespectState } from '@pokatim/contracts';

import type { PublicRiderCard } from '../profile';
import { riderGroup } from './ride-participants.view';

/** Цели нет (снятая, DQ, финишёр, черновик; маршрут команды, скрытый — RC-P4-3): кнопки и счётчика нет. */
export const NEUTRAL_RESPECT: RespectState = {
  available: false,
  respected: false,
  count: 0,
  own: false,
  from: null,
};

/**
 * Состояние «Респекта» зрителя (P4, K8): `own` — зритель получатель, `available` — цель есть и зритель не получатель;
 * `from` — только получателю: публичные поставившие строками (порядок `actorIds`), остальные и сверх `actorIds` —
 * числом (K3). Получатель наружу не выходит.
 */
export function respectStateView(input: {
  target: { recipientId: string } | null;
  viewerId: string;
  count: number;
  respected: boolean;
  actorIds: readonly string[];
  cards: ReadonlyMap<string, PublicRiderCard>;
}): RespectState {
  if (!input.target) return NEUTRAL_RESPECT;
  const own = input.viewerId === input.target.recipientId;
  if (!own) {
    return { available: true, respected: input.respected, count: input.count, own, from: null };
  }
  const { riders } = riderGroup(input.actorIds, input.cards);
  return {
    available: false,
    respected: false,
    count: input.count,
    own,
    from: { riders, hiddenCount: Math.max(0, input.count - riders.length) },
  };
}
