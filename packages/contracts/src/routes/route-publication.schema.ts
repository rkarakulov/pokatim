import { z } from 'zod';

import { fieldError, tolerantEnum } from '../common.ts';
import { CITY_CODES, CityCode } from '../geo/city.schema.ts';
import { SURFACES, SurfaceList } from '../races/race.schema.ts';

/*
 * Публикация своего маршрута в каталог (routes-06, UGC): райдер подаёт готовый маршрут, модератор панели одобряет или
 * отклоняет (премодерация, U1). Ответы приложения — `tolerantEnum` (R6); запросы — строгие. Отзыв и снятие автором —
 * внутреннее состояние сервера, наружу — `publication: null`.
 */

/** Состояния публикации, видимые автору и панели; только в конец. */
export const ROUTE_PUBLICATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export const RoutePublicationStatus = z.enum(ROUTE_PUBLICATION_STATUSES);
export type RoutePublicationStatus = z.infer<typeof RoutePublicationStatus>;

/** Причины отклонения заявки (U5); подписи — `domain.routeRejectionReason.*`. Только в конец. */
export const ROUTE_REJECTION_REASONS = [
  'dangerous',
  'impassable',
  'duplicate',
  'bad_title',
  'not_cycling',
  'other',
] as const;
export const RouteRejectionReason = z.enum(ROUTE_REJECTION_REASONS, {
  error: fieldError('REQUIRED'),
});
export type RouteRejectionReason = z.infer<typeof RouteRejectionReason>;

/** Комментарий модератора автору при отклонении, символов. */
export const ROUTE_PUBLICATION_COMMENT_MAX = 500;
/** Заявок райдера на рассмотрении одновременно (U8): больше — `409 ROUTE_PUBLICATION_LIMIT {limit: 'pending'}`. */
export const ROUTE_PUBLICATION_MAX_PENDING = 3;
/** Подач одного маршрута (U8; отзыв и снятие не возвращают): больше — `{limit: 'route_submissions'}`. */
export const ROUTE_PUBLICATION_MAX_SUBMISSIONS = 3;

/**
 * `POST /v1/routes/mine/:id/publish` → `MyRoute`: заявка готового маршрута — город старта и покрытие (как в панели),
 * согласие подписать маршрут публичным именем профиля (U3).
 */
export const SubmitRoutePublicationInput = z.strictObject({
  city: CityCode,
  surfaces: SurfaceList,
  showAuthorName: z.boolean({ error: fieldError('REQUIRED') }),
});
export type SubmitRoutePublicationInput = z.infer<typeof SubmitRoutePublicationInput>;

/** Состояние публикации своего маршрута; `rejection` — только у `rejected`. */
export const MyRoutePublication = z.object({
  status: tolerantEnum(ROUTE_PUBLICATION_STATUSES),
  city: tolerantEnum(CITY_CODES),
  surfaces: z.array(tolerantEnum(SURFACES)),
  showAuthorName: z.boolean(),
  submittedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  rejection: z
    .object({
      reason: tolerantEnum(ROUTE_REJECTION_REASONS),
      comment: z.string().nullable(),
    })
    .nullable(),
});
export type MyRoutePublication = z.infer<typeof MyRoutePublication>;

/**
 * Причина `409 ROUTE_INVALID_STATE` маршрутов райдера (`details`): не готов; заявка на проверке; опубликован; скрыт
 * модератором; жалоба на свой маршрут; на маршрут команды. Панель routes-01 шлёт код без `details`. Только в конец.
 */
export const ROUTE_STATE_REASONS = [
  'not_ready',
  'in_review',
  'published',
  'hidden',
  'own_route',
  'team_route',
] as const;
export const RouteStateDetails = z.object({ reason: tolerantEnum(ROUTE_STATE_REASONS) });
export type RouteStateDetails = z.infer<typeof RouteStateDetails>;

/** Какой лимит подач U8 исчерпан (`details` у `409 ROUTE_PUBLICATION_LIMIT`). Только в конец. */
export const ROUTE_PUBLICATION_LIMITS = ['pending', 'route_submissions'] as const;
export const RoutePublicationLimitDetails = z.object({
  limit: tolerantEnum(ROUTE_PUBLICATION_LIMITS),
  max: z.number().int(),
});
export type RoutePublicationLimitDetails = z.infer<typeof RoutePublicationLimitDetails>;
