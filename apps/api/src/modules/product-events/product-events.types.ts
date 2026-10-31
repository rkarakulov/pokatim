import {
  AttendanceVia,
  ConnectionSource,
  LocalDate,
  RideJoinSource,
  Uuid,
} from '@pokatim/contracts';
import { z } from 'zod';

/**
 * Справочник продуктовых событий (K12, ADR-0027 п. 7): журнал наружу не уходит, поэтому схема — в API, не в contracts
 * (RC-11). `props` — только поля-справочники (`strictObject`): ни id других пользователей (RC-12 — стирание удаляет
 * события только по их `userId`), ни свободного JSON с ПДн. Типы — только в конец.
 */
export const PRODUCT_EVENT_TYPES = [
  'connection-created',
  'ride-joined',
  'attendance-marked',
  'thanks-sent',
  'respect-sent',
  'invite-registered',
  'name-published',
  'active-day',
] as const;
export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

const NoProps = z.strictObject({});
const event = <T extends ProductEventType, P extends z.ZodType>(type: T, props: P) =>
  z.strictObject({ type: z.literal(type), userId: Uuid, props });

/** Событие на запись: неизвестный тип или лишнее поле — ошибка разбора (`PRODUCT_EVENTS.record` бросает). */
export const ProductEventInput = z.discriminatedUnion('type', [
  event('connection-created', z.strictObject({ source: ConnectionSource })),
  event('ride-joined', z.strictObject({ source: RideJoinSource })),
  event('attendance-marked', z.strictObject({ via: AttendanceVia })),
  event('thanks-sent', NoProps),
  event('respect-sent', z.strictObject({ targetType: z.enum(['race_entry', 'route']) })),
  // userId — пригласивший; id приглашённого не пишется (RC-12)
  event('invite-registered', NoProps),
  event('name-published', NoProps),
  // первый авторизованный запрос за сутки по Минску (P7)
  event('active-day', z.strictObject({ day: LocalDate })),
]);
export type ProductEventInput = z.infer<typeof ProductEventInput>;
