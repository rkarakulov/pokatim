import type { AttemptStatus, PanelRaceStandingsQuery } from '@pokatim/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api } from '../../api';
import { RACES_QUERY_KEY } from '../races/races-query';

/**
 * Ключи результатов — под ключом гонки (`['admin','races','item',id]`): инвалидация гонки обновляет и результаты, а
 * действие над результатами — и гонку (фаза `final`).
 */
export const raceItemKey = (raceId: string) => [...RACES_QUERY_KEY, 'item', raceId] as const;

export const resultsSummaryQuery = (raceId: string) =>
  queryOptions({
    queryKey: [...raceItemKey(raceId), 'results'],
    queryFn: () => api.getRaceResultsSummary(raceId),
  });

/**
 * «Участники» с фильтрами (race-results-07): группа, «Требует внимания» и «только финишёры» — в ключе и в запросе. Прежний ответ держится
 * на время загрузки (`keepPreviousData`), чтобы вкладки групп не пропадали; таблица в это время — скелетон.
 */
export const standingsQuery = (raceId: string, filter: PanelRaceStandingsQuery = {}) =>
  queryOptions({
    queryKey: [
      ...raceItemKey(raceId),
      'standings',
      filter.group ?? 'all',
      filter.attention ? 'attention' : 'all',
      filter.finishers ? 'finishers' : 'all',
    ],
    queryFn: () => api.getRaceStandings(raceId, filter),
    placeholderData: keepPreviousData,
  });

export const recalculationsQuery = (raceId: string) =>
  queryOptions({
    queryKey: [...raceItemKey(raceId), 'recalculations'],
    queryFn: () => api.listProtocolRecalculations(raceId),
  });

export const attemptsQueryKey = (raceId: string, status: AttemptStatus | undefined) =>
  [...raceItemKey(raceId), 'attempts', status ?? 'all'] as const;

/** Пол и год анкеты Verified для окна правки (`profiles.verified_edit`): всегда свежие, в кэше не задерживаются. */
export const verifiedDemographicsQuery = (userId: string) =>
  queryOptions({
    queryKey: ['admin', 'profiles', userId, 'verified-demographics'],
    queryFn: () => api.getVerifiedDemographics(userId),
    gcTime: 0,
    staleTime: 0,
  });
