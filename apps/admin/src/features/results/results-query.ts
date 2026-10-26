import type { AttemptStatus } from '@pokatim/contracts';
import { queryOptions } from '@tanstack/react-query';

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

export const standingsQuery = (raceId: string) =>
  queryOptions({
    queryKey: [...raceItemKey(raceId), 'standings'],
    queryFn: () => api.getRaceStandings(raceId),
  });

export const recalculationsQuery = (raceId: string) =>
  queryOptions({
    queryKey: [...raceItemKey(raceId), 'recalculations'],
    queryFn: () => api.listProtocolRecalculations(raceId),
  });

export const attemptsQueryKey = (raceId: string, status: AttemptStatus | undefined) =>
  [...raceItemKey(raceId), 'attempts', status ?? 'all'] as const;
