import { create } from 'zustand';

import type { SoftPromptContext } from './push-soft-prompt-state';

/**
 * Состояние подсказки push (N5) в памяти: за запуск приложения — один показ. Отдельно от компонента — мутации
 * предлагают подсказку без зависимостей UI, тесты сбрасывают стор как новый запуск (`jest.setup.ts`).
 */
interface SoftPromptStore {
  /** объект, после действия с которым предложена подсказка (`ride:<id>` / `race:<id>`) */
  offer: string | null;
  /** подсказку уже показали в этом запуске — новые предложения не принимаются */
  shown: boolean;
}

const initial: SoftPromptStore = { offer: null, shown: false };
export const useSoftPromptStore = create<SoftPromptStore>(() => initial);

export const anchorOf = (context: SoftPromptContext, id: string) => `${context}:${id}`;
export const closeSoftPrompt = () => useSoftPromptStore.setState({ offer: null });

/** Успех «Я иду» / записи на гонку: предложить подсказку под этим действием (если в этом запуске её ещё не было). */
export function offerPushSoftPrompt(context: SoftPromptContext, id: string): void {
  if (useSoftPromptStore.getState().shown) return;
  useSoftPromptStore.setState({ offer: anchorOf(context, id) });
}

/** Новый запуск приложения (тесты). */
export function resetPushSoftPrompt(): void {
  useSoftPromptStore.setState(initial);
}
