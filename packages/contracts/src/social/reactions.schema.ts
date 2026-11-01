import { z } from 'zod';

import { RiderPublicId } from '../profile/rider-avatar.schema.ts';
import { RideRiderGroup } from './ride-participants.schema.ts';

/*
 * Реакции «Свои» (P4, K5, K8, ADR-0027 п. 3): данные вошедшего зрителя — эндпоинты `social` под `AuthGuard`,
 * `no-store`; публичные таблица результатов и карточка маршрута не меняются.
 */

/**
 * `POST /v1/rides/:id/thanks` — «Спасибо за компанию»: с `publicId` — одному явившемуся публичному, без —
 * «Поблагодарить всех» (всем явившимся, включая непубличных). Лишние ключи — 400. Ответ — `RideParticipants`.
 */
export const RideThanksRequest = z.strictObject({ publicId: RiderPublicId.optional() });
export type RideThanksRequest = z.infer<typeof RideThanksRequest>;

/** `PUT …/respect` — идемпотентно поставить (`true`) или снять (`false`) «Респект»; получатель — с сервера. */
export const SetRespectRequest = z.strictObject({ respected: z.boolean() });
export type SetRespectRequest = z.infer<typeof SetRespectRequest>;

/**
 * Состояние «Респекта» зрителя (`GET|PUT /v1/races/:raceId/results/:entryId/respect`, `GET|PUT /v1/routes/:id/respect`):
 * `available` — цель есть и зритель не получатель; `count` — всего; `own` — зритель получатель; `from` — только
 * получателю: публичные поставившие строками, остальные числом (K3). Цели нет — всё по умолчанию.
 */
export const RespectState = z.object({
  available: z.boolean().default(false),
  respected: z.boolean().default(false),
  count: z.number().int().min(0).default(0),
  own: z.boolean().default(false),
  from: RideRiderGroup.nullable().default(null),
});
export type RespectState = z.infer<typeof RespectState>;
