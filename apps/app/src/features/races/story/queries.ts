import type { StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS, shouldRetry } from '@/lib/query-client';
import { prepareStory } from '@/lib/share-story';

import { STORY_POLL_LIMIT_MS, STORY_POLL_MS, StoryCardNotReady } from './story-format';

/*
 * Карточка для сторис (story-cards): статус — только вошедшему (`withAccessToken`), опрос раз в секунду, пока
 * `pending`, не дольше 30 с (отсчёт от первого `pending` шаблона; повтор сбрасывает отсчёт). `failed` и таймаут —
 * ошибка с повтором; `409 STORY_CARD_UNAVAILABLE` — без ретраев (экран — «Карточки пока нет»).
 */

export const storyCardKey = (raceId: string, template: StoryCardTemplate) =>
  ['races', 'story', raceId, template] as const;

/** Повтор — как у проекта (`shouldRetry`: без 4xx, в т.ч. 409 и 429); не готова / провал — без повторов. */
const retryable = (count: number, error: unknown) =>
  !(error instanceof StoryCardNotReady) && shouldRetry(count, error);

/** Готовая карточка (`ready` с токеном); `pending` — `isPending` до готовности, ошибки — без данных (повтор). */
export function useStoryCard(raceId: string, template: StoryCardTemplate, enabled: boolean) {
  // начало ожидания по шаблону: смена чипа не сбрасывает отсчёт другого шаблона
  const started = useRef(new Map<StoryCardTemplate, number>());
  const query = useQuery({
    queryKey: storyCardKey(raceId, template),
    queryFn: async (): Promise<StoryCardStatus> => {
      const status = await withAccessToken((token) =>
        api.getStoryCard(token, raceId, { template }),
      );
      if (status.status === 'pending') {
        const since = started.current.get(template) ?? Date.now();
        started.current.set(template, since);
        if (Date.now() - since >= STORY_POLL_LIMIT_MS) throw new StoryCardNotReady('timeout');
        return status;
      }
      started.current.delete(template);
      if (status.status === 'failed') throw new StoryCardNotReady('failed');
      return status;
    },
    staleTime: DEFAULT_STALE_MS,
    retry: retryable,
    refetchInterval: (q) =>
      q.state.status === 'success' && q.state.data?.status === 'pending' ? STORY_POLL_MS : false,
    enabled,
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    started.current.delete(template);
    return refetch();
  }, [refetch, template]);
  // готовая карточка остаётся и при ошибке обновления (AGENTS §4.12: данные + баннер с повтором): ошибки
  // «не готова» и 409 бывают только когда новый ответ — не `ready`, тогда в кэше уже нет готовой
  const ready = query.data?.status === 'ready' ? query.data : undefined;
  return {
    /** состояние для `AsyncContent`: данные — только готовая карточка, `pending` — загрузка */
    state: {
      data: ready,
      error: query.error,
      isPending: !query.isError && ready === undefined,
      isError: query.isError,
      fetchStatus: query.fetchStatus,
      refetch: retry,
    },
    unavailable: apiErrorCode(query.error) === 'STORY_CARD_UNAVAILABLE',
  };
}

/** PNG готовой карточки — заранее (web: `File` для Web Share в пределах жеста, RC-13; native — файл в кэше). */
export function useStoryFile(raceId: string, template: StoryCardTemplate, token: string | null) {
  return useQuery({
    queryKey: [...storyCardKey(raceId, template), 'file', token] as const,
    queryFn: () => prepareStory(api.storyCardImageUrl(token!)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    enabled: token !== null,
  });
}
