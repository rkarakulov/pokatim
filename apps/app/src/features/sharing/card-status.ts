import {
  STORY_CARD_TEMPLATES,
  type StoryCardStatus,
  type StoryCardTemplate,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS, shouldRetry } from '@/lib/query-client';
import { prepareStory } from '@/lib/share-story';
import { useAppTheme } from '@/theme/use-app-theme';

/*
 * Карточки сервера (ADR-0018: сторис результата гонки, приглашение кофе-райда): статус — только вошедшему
 * (`withAccessToken`), опрос раз в секунду, пока `pending`, не дольше 30 с (отсчёт от первого `pending` шаблона;
 * повтор сбрасывает отсчёт). `failed` и таймаут — ошибка с повтором; `409 STORY_CARD_UNAVAILABLE` — без ретраев
 * (экран — пустое состояние).
 */

/** Шаблоны карточки в порядке контракта и их подписи (чипы экрана). */
export const cardTemplates = STORY_CARD_TEMPLATES.map((template) => ({
  template,
  label: t(`story.template.${template}`),
}));

/** Опрос статуса карточки: раз в секунду, не дольше 30 с от первого `pending` — дальше ошибка с повтором. */
export const STORY_POLL_MS = 1000;
export const STORY_POLL_LIMIT_MS = 30_000;

/** Карточка не готова за `STORY_POLL_LIMIT_MS` или рендер не удался (`failed`) — экран: «Не удалось загрузить». */
export class StoryCardNotReady extends Error {
  constructor(readonly reason: 'timeout' | 'failed') {
    super(`story card ${reason}`);
    this.name = 'StoryCardNotReady';
  }
}

/** Источник карточки: ключ запроса шаблона и запрос статуса с access-токеном. */
export interface CardSource {
  key: (template: StoryCardTemplate) => readonly unknown[];
  fetch: (accessToken: string, template: StoryCardTemplate) => Promise<StoryCardStatus>;
}

/** Метка запросов статуса карточек: по ней их находит инвалидация после смены темы. */
const CARD_STATUS_META = { cardStatus: true } as const;

/**
 * Тема сохранена на сервере (`useSetTheme`): статусы карточек — перезапросить. Ключ уже с новой темой (оптимистично), но
 * ответ, полученный до сохранения, — карточка прежней темы; инвалидация отменяет и запрос в полёте.
 */
export const invalidateCardStatuses = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ predicate: (query) => query.meta?.cardStatus === true });

/** Повтор — как у проекта (`shouldRetry`: без 4xx, в т.ч. 409 и 429); не готова / провал — без повторов. */
const retryable = (count: number, error: unknown) =>
  !(error instanceof StoryCardNotReady) && shouldRetry(count, error);

/** Готовая карточка (`ready` с токеном); `pending` — `isPending` до готовности, ошибки — без данных (повтор). */
export function useCardStatus(source: CardSource, template: StoryCardTemplate, enabled: boolean) {
  // сервер рисует карточку в теме запрашивающего (хэш с `themeId`): смена темы — другой ключ, а не старая картинка
  // из кэша на `staleTime`
  const themeId = useAppTheme().id;
  // начало ожидания по шаблону и теме (как ключ запроса): смена чипа или темы не наследует чужой отсчёт
  const started = useRef(new Map<string, number>());
  const pollKey = `${template}:${themeId}`;
  const query = useQuery({
    queryKey: [...source.key(template), themeId],
    meta: CARD_STATUS_META,
    queryFn: async (): Promise<StoryCardStatus> => {
      const status = await withAccessToken((token) => source.fetch(token, template));
      if (status.status === 'pending') {
        const since = started.current.get(pollKey) ?? Date.now();
        started.current.set(pollKey, since);
        if (Date.now() - since >= STORY_POLL_LIMIT_MS) throw new StoryCardNotReady('timeout');
        return status;
      }
      started.current.delete(pollKey);
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
    started.current.delete(pollKey);
    return refetch();
  }, [refetch, pollKey]);
  // готовая карточка остаётся при ошибке обновления (AGENTS §4.12: данные + баннер с повтором) — TanStack при броске
  // из `queryFn` хранит прежние `data`. Ответ `pending`/`failed` нового хэша приходит успешным ответом `pending`,
  // который заменяет `data`; 409 (и 404 — по выбору экрана) показывают пустое состояние до `AsyncContent`
  const ready = query.data?.status === 'ready' ? query.data : undefined;
  const code = apiErrorCode(query.error);
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
    unavailable: code === 'STORY_CARD_UNAVAILABLE',
    notFound: code === 'NOT_FOUND',
  };
}

/** PNG готовой карточки — заранее (web: `File` для Web Share в пределах жеста, RC-13; native — файл в кэше). */
export function useCardFile(key: readonly unknown[], token: string | null) {
  return useQuery({
    queryKey: [...key, 'file', token] as const,
    queryFn: () => prepareStory(api.storyCardImageUrl(token!)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    enabled: token !== null,
  });
}
