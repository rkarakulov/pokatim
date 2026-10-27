import { AppAppearance, DEFAULT_APP_THEME_ID, type AppThemeId } from '@pokatim/contracts';

import { fetchPublicForSsr } from '@/lib/public-ssr';

import { toAppThemeId } from './theme-id';

/**
 * Окно между попытками к API — при любом исходе (успех, сеть, таймаут, 429, 5xx); отсчёт — от завершения попытки.
 * Единственное окно: кэш `fetchPublicForSsr` для темы выключен.
 */
const ATTEMPT_INTERVAL_MS = 60_000;

/**
 * Страницы, перед рендером которых middleware обновляет тему: путь без точки и не `/_expo/*` (loader-ы, статика).
 * Manifest, `sw.js`, иконки и ассеты тему не ждут — им достаточно последней известной.
 */
export const SSR_THEME_PATHS: RegExp[] = [/^\/(?!_expo\/)[^.]*$/];

interface SsrThemeState {
  /** последняя известная тема процесса */
  themeId?: AppThemeId;
  /** время завершения последней попытки */
  attemptAt?: number;
  /** запрос в полёте — общий для параллельных страниц (single-flight) */
  inflight?: Promise<void>;
  /** первая попытка процесса завершилась (с любым исходом): дальше рендер API не ждёт */
  settled?: boolean;
}

/**
 * Тема процесса web-сервера (SSR). Тема глобальна (T1): одна на процесс, как кэш публичных данных `public-ssr.ts`, —
 * поэтому исключение из «сторов не на уровне модуля»: не сессия и не ПДн. Состояние — в `globalThis` под `Symbol.for`:
 * серверные бандлы рендера, `+middleware.ts` и API-маршрутов — разные графы модулей одного процесса, переменная модуля
 * им общей не была бы.
 */
const KEY = Symbol.for('pokatim.appTheme');

function state(): SsrThemeState {
  const holder = globalThis as { [KEY]?: SsrThemeState };
  holder[KEY] ??= {};
  return holder[KEY];
}

/** Активная тема процесса; ещё не узнавали или API недоступен с запуска — «Классика». */
export function ssrThemeId(): AppThemeId {
  return state().themeId ?? DEFAULT_APP_THEME_ID;
}

/**
 * Обновить тему из API (`+middleware.ts`, перед рендером страницы). Не чаще раза в 60 с (от завершения прошлой попытки) при
 * любом исходе, параллельные страницы делят один запрос, кэш публичных данных не используется. Ждёт только первая попытка процесса (таймаут `fetchPublicForSsr` — 2 с; сбой —
 * «Классика»); дальше — обновление в фоне, рендер идёт в последней известной теме, клиент догонит запросом.
 */
export function refreshSsrTheme(): Promise<void> {
  const current = state();
  const due =
    current.attemptAt === undefined || Date.now() - current.attemptAt >= ATTEMPT_INTERVAL_MS;
  if (!current.inflight && due) {
    current.inflight = fetchPublicForSsr('/v1/appearance', AppAppearance, { cache: false })
      .then((result) => {
        if (result.status === 'found') current.themeId = toAppThemeId(result.data.themeId);
      })
      .catch(() => undefined)
      .finally(() => {
        current.attemptAt = Date.now();
        current.inflight = undefined;
        current.settled = true;
      });
  }
  return current.settled ? Promise.resolve() : (current.inflight ?? Promise.resolve());
}
