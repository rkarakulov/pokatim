import type { BikeClass, ResultGroupKey } from '@pokatim/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { api } from '../../api';
import { SEASONS_QUERY_KEY } from './seasons-query';

/** Ключи рейтинга — под ключом сезонов: инвалидация «Сезонов» обновляет и рейтинг. */
export const seasonStandingsKey = (seasonId: string) =>
  [...SEASONS_QUERY_KEY, seasonId, 'standings'] as const;

/** Сводка рейтинга сезона панели: таблицы, время пересчёта, версия формулы, «Ждёт пересчёта» (`no-store`). */
export const seasonStandingsQuery = (seasonId: string) =>
  queryOptions({
    queryKey: seasonStandingsKey(seasonId),
    queryFn: () => api.getSeasonStandings(seasonId),
  });

export interface StandingsTableKey {
  bikeClass: BikeClass;
  group: ResultGroupKey;
}

/** Таблица «класс × группа» по страницам курсора сервера (`order` строки). */
export const seasonStandingsTableQuery = (
  seasonId: string,
  { bikeClass, group }: StandingsTableKey,
) =>
  infiniteQueryOptions({
    queryKey: [...seasonStandingsKey(seasonId), 'table', bikeClass, group],
    queryFn: ({ pageParam }) =>
      api.getSeasonStandingsTable(seasonId, {
        bikeClass,
        group,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
