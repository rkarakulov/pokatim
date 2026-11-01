import { z } from 'zod';

import { Uuid } from '../common.ts';
import { RiderPublicId } from '../profile/rider-avatar.schema.ts';
import { RideCard } from '../rides/ride.schema.ts';
import { CatalogRouteCard } from '../routes/route-catalog.schema.ts';
import { RideRiderRow } from './ride-participants.schema.ts';

/*
 * Секция «Свои» на Главной (K7, social-p7, ADR-0027 п. 3): `GET /v1/social/home` — вошедшему, `no-store`. Строки
 * собирает и отбирает сервер; клиент только форматирует. `userId` в ответе нет.
 */

/** Строк в секции — не больше (K7). */
export const SOCIAL_HOME_ROWS_MAX = 3;
/** «Своих» в строке райда — не больше; остальные — числом. */
export const SOCIAL_HOME_RIDERS_MAX = 3;

/** «Свой» в строке: только публичный (K3) — имя, ссылка, фото; без `userId`. */
export const SocialHomeRider = RideRiderRow.extend({ publicId: RiderPublicId });
export type SocialHomeRider = z.infer<typeof SocialHomeRider>;

/** «Катя Л. и ещё 2 идут»: карточка ленты со зрителем и «свои» в райде. */
export const SocialHomeRideRow = z.object({
  kind: z.literal('ride'),
  ride: RideCard,
  riders: z.array(SocialHomeRider).min(1).max(SOCIAL_HOME_RIDERS_MAX),
  /** остальные «свои» в райде */
  othersCount: z.number().int().min(0),
});
export type SocialHomeRideRow = z.infer<typeof SocialHomeRideRow>;

/** «Андрей К. · 1:59:40»: строка опубликованного протокола «своего». */
export const SocialHomeResultRow = z.object({
  kind: z.literal('result'),
  rider: SocialHomeRider,
  race: z.object({ id: Uuid, title: z.string() }),
  entryId: Uuid,
  place: z.number().int(),
  tied: z.boolean(),
  elapsedSec: z.number().int(),
  /** своё − зрителя, сек; минус — «быстрее вас»; зритель не в той же гонке и группе — `null` */
  deltaSec: z.number().int().nullable().default(null),
});
export type SocialHomeResultRow = z.infer<typeof SocialHomeResultRow>;

/** «Новый маршрут от Сергея К.»: маршрут «своего» в каталоге. */
export const SocialHomeRouteRow = z.object({
  kind: z.literal('route'),
  rider: SocialHomeRider,
  route: CatalogRouteCard,
});
export type SocialHomeRouteRow = z.infer<typeof SocialHomeRouteRow>;

export const SocialHomeRow = z.discriminatedUnion('kind', [
  SocialHomeRideRow,
  SocialHomeResultRow,
  SocialHomeRouteRow,
]);
export type SocialHomeRow = z.infer<typeof SocialHomeRow>;

/**
 * `GET /v1/social/home` (no-store): ≤ `SOCIAL_HOME_ROWS_MAX` строк в порядке сервера; пусто — секция скрыта. Строка
 * незнакомого вида или не по схеме отбрасывается (старые сборки), ответ целиком не падает.
 */
export const SocialHome = z.object({
  items: z.array(z.unknown()).transform((rows) =>
    rows.flatMap((row) => {
      const parsed = SocialHomeRow.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type SocialHome = z.output<typeof SocialHome>;
