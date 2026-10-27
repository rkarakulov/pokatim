import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { httpStatus } from '../../session/errors';
import { RACES_QUERY_KEY } from '../races/races-query';
import { raceItemKey } from './results-query';

/** Окно действия над результатами: `ReasonDialog` с обязательной причиной (уходит в журнал на сервере). */
export interface ResultsDialog {
  title: string;
  consequences: string;
  confirmLabel: string;
  destructive?: boolean;
  run: (reason: string) => Promise<unknown>;
}

export type OpenResultsDialog = (dialog: ResultsDialog) => void;

/**
 * Выполнить действие и обновить гонку, все её результаты, список гонок и журнал. Отказ состояния (409) — тоже
 * обновление: текст ошибки остаётся в окне, а данные под ним — уже актуальные.
 */
export function useResultsAction(raceId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (call: () => Promise<unknown>) => {
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: raceItemKey(raceId) }),
          // фаза гонки в списке и запись журнала меняются вместе с результатами
          queryClient.invalidateQueries({ queryKey: [...RACES_QUERY_KEY, 'list'] }),
          queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
        ]);
      try {
        await call();
      } catch (error) {
        if (httpStatus(error) === 409) void refresh();
        throw error;
      }
      await refresh();
    },
    [queryClient, raceId],
  );
}
