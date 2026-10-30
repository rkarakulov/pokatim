import { create } from 'zustand';

import type { SoftPromptContext } from './push-soft-prompt-state';

/**
 * Состояние подсказки push (N5) в памяти — одно на запуск приложения, общее для всех мест показа. Отдельно от
 * компонента: мутации (`useRideRsvp`, `useEnterRace`) предлагают подсказку без зависимостей UI, тесты сбрасывают
 * стор как новый запуск (`jest.setup.ts`).
 *
 * Фазы: `idle` — в этом запуске не показывали (предложение принимается); `checking` — предложено, владелец читает
 * поддержку, разрешение и отложку; `offer` — показана («Включить» / «Не сейчас»); `denied` — текст отказа;
 * `closed` — показ был и закончился (выдано, «Не сейчас», «Не иду», владелец ушёл с экрана) — до перезапуска больше нет.
 *
 * Владелец — первое место этого объекта на сфокусированном экране (скрытая лента под карточкой показ не забирает).
 * Предложение, которое никто не забрал за `SOFT_PROMPT_CLAIM_MS` (ушли с экрана до ответа мутации), снимается:
 * показ не потрачен, а открытие объекта позже подсказку не покажет (AC1).
 */
export type SoftPromptPhase = 'idle' | 'checking' | 'offer' | 'denied' | 'closed';

interface SoftPromptStore {
  /** объект, после действия с которым предложена подсказка (`ride:<id>` / `race:<id>`) */
  anchor: string | null;
  phase: SoftPromptPhase;
  /**
   * Место, за которым закреплён показ: первое смонтированное с этим объектом (герой, строка ленты и карточка одного
   * райда не показывают подсказку трижды и не спрашивают дважды).
   */
  owner: object | null;
}

/** Срок, за который место на экране должно забрать предложение (смена блока на том же экране — миллисекунды). */
export const SOFT_PROMPT_CLAIM_MS = 3_000;

const initial: SoftPromptStore = { anchor: null, phase: 'idle', owner: null };
export const useSoftPromptStore = create<SoftPromptStore>(() => initial);

export const anchorOf = (context: SoftPromptContext, id: string) => `${context}:${id}`;

/** Предложение живо (решается или показано) для этого объекта. */
export const isOffered = (state: SoftPromptStore, anchor: string): boolean =>
  state.anchor === anchor &&
  (state.phase === 'checking' || state.phase === 'offer' || state.phase === 'denied');

/** Успех «Я иду» / новой записи на гонку: предложить подсказку (если в этом запуске её ещё не показывали). */
export function offerPushSoftPrompt(context: SoftPromptContext, id: string): void {
  if (useSoftPromptStore.getState().phase !== 'idle') return;
  useSoftPromptStore.setState({ anchor: anchorOf(context, id), phase: 'checking', owner: null });
  const offered = useSoftPromptStore.getState();
  setTimeout(() => {
    // то же предложение (не новое после сброса) и его никто не забрал
    const state = useSoftPromptStore.getState();
    if (state === offered) useSoftPromptStore.setState(initial);
  }, SOFT_PROMPT_CLAIM_MS);
}

/** «Не иду»: подсказка этого райда закрывается (ещё не показана — как не предлагали). */
export function closePushSoftPromptFor(context: SoftPromptContext, id: string): void {
  const state = useSoftPromptStore.getState();
  if (!isOffered(state, anchorOf(context, id))) return;
  useSoftPromptStore.setState(
    state.phase === 'checking' ? initial : { phase: 'closed', owner: null },
  );
}

/** Место с этим объектом на сфокусированном экране: показ закрепляется за первым. */
export function claimSoftPrompt(anchor: string, owner: object): void {
  const state = useSoftPromptStore.getState();
  if (state.owner === null && isOffered(state, anchor)) useSoftPromptStore.setState({ owner });
}

/**
 * Владелец размонтирован или его экран потерял фокус: показанная подсказка закрыта до перезапуска; не успели
 * показать — как не предлагали.
 */
export function releaseSoftPrompt(owner: object): void {
  const state = useSoftPromptStore.getState();
  if (state.owner !== owner) return;
  useSoftPromptStore.setState(
    state.phase === 'checking' ? initial : { phase: 'closed', owner: null },
  );
}

/** Решение владельца: показать или нет (выдано, нет поддержки, отложена — как не предлагали). */
export function decideSoftPrompt(visible: boolean): void {
  if (useSoftPromptStore.getState().phase !== 'checking') return;
  useSoftPromptStore.setState(visible ? { phase: 'offer' } : initial);
}

/** Ответ на «Включить» / «Не сейчас»: отказ — текст отказа, иначе подсказка закрыта. */
export function finishSoftPrompt(phase: 'denied' | 'closed'): void {
  const state = useSoftPromptStore.getState();
  if (state.phase !== 'offer' && state.phase !== 'denied') return;
  useSoftPromptStore.setState(phase === 'closed' ? { phase, owner: null } : { phase });
}

/** Новый запуск приложения (тесты). */
export function resetPushSoftPrompt(): void {
  useSoftPromptStore.setState(initial);
}
