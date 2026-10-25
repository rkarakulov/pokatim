import { z } from 'zod';
import { create } from 'zustand';

import { api } from '@/lib/api';
import { withAccessToken } from '@/features/auth/authorized';
import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

/**
 * Опрос: `unknown` — ещё не выяснили; `required` — сервер ответа не знает; `completed` — ответ есть (сервер или кеш
 * устройства); `unavailable` — выяснить не удалось (сеть, сбой API): вкладки показывают ошибку с повтором.
 */
export type SurveyState = 'unknown' | 'required' | 'completed' | 'unavailable';
/** Шаг геопозиции: `pending` — показать экран; `done` — решено (флаг устройства или решение ОС). */
export type LocationStepState = 'unknown' | 'pending' | 'done';
/** Шаг онбординга для гарда: опрос → геопозиция → Главная. */
export type OnboardingStep = 'unknown' | 'survey' | 'location' | 'done';

/** Кеш «опрос пройден» — привязан к сессии (стирается при выходе): офлайн-старт native не ждёт сервер (R4). */
const SURVEY_KEY = 'pokatim.onboarding';
const SurveyFlag = z.object({ surveyCompleted: z.literal(true) });

interface OnboardingState {
  survey: SurveyState;
  location: LocationStepState;
  /** причина `unavailable` — «Нет соединения» или «Не удалось загрузить» */
  error: unknown;
  /** после входа (эффект корневого layout): опрос — кеш или сервер, геопозиция — флаг устройства и ОС */
  hydrate: () => Promise<void>;
  /** повтор после `unavailable`: снова «неизвестно» (скелетон) — корневой layout выясняет заново */
  retry: () => void;
  /** ответ опроса сохранён на сервере */
  completeSurvey: () => Promise<void>;
  /** выход: состояние и кеш опроса прежнего аккаунта стираются; флаг геопозиции (устройство) остаётся */
  reset: () => Promise<void>;
}

export const onboardingStep = (
  state: Pick<OnboardingState, 'survey' | 'location'>,
): OnboardingStep => {
  if (state.survey === 'unknown' || state.survey === 'unavailable') return 'unknown';
  if (state.survey === 'required') return 'survey';
  if (state.location === 'unknown') return 'unknown';
  return state.location === 'pending' ? 'location' : 'done';
};

async function writeSurveyFlag(): Promise<void> {
  try {
    await secureStorage.set(SURVEY_KEY, JSON.stringify({ surveyCompleted: true }));
  } catch (error) {
    // без кеша следующий запуск спросит сервер — не падение
    console.warn(`onboarding flag not persisted: ${(error as Error).name}`);
  }
}

async function surveyState(): Promise<Pick<OnboardingState, 'survey' | 'error'>> {
  const cached = await readJson(SURVEY_KEY, (value) =>
    SurveyFlag.safeParse(value).success ? true : undefined,
  );
  if (cached) return { survey: 'completed', error: null };
  try {
    const status = await withAccessToken((token) => api.getOnboardingStatus(token));
    if (!status.surveyCompleted) return { survey: 'required', error: null };
    await writeSurveyFlag();
    return { survey: 'completed', error: null };
  } catch (error) {
    // 401 после обновления — сессия уже закрыта, гард ведёт на «Вход»; прочее — повтор с вкладок
    return { survey: 'unavailable', error };
  }
}

/** Шаг геопозиции (слайс 4, S5): пока экрана нет — решён. */
async function locationState(): Promise<LocationStepState> {
  return 'done';
}

/** Поколение состояния: ответ гидрации, начатой до выхода, не перезаписывает сброс. */
let generation = 0;

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  survey: 'unknown',
  location: 'unknown',
  error: null,
  hydrate: async () => {
    const started = (generation += 1);
    const [survey, location] = await Promise.all([surveyState(), locationState()]);
    if (started !== generation) return;
    set({ ...survey, location });
  },
  retry: () => {
    if (get().survey === 'unavailable') set({ survey: 'unknown', error: null });
  },
  completeSurvey: async () => {
    set({ survey: 'completed', error: null });
    await writeSurveyFlag();
  },
  reset: async () => {
    generation += 1;
    set({ survey: 'unknown', location: 'unknown', error: null });
    await secureStorage.delete(SURVEY_KEY).catch(() => undefined);
  },
}));

/** Для тестов: состояние «только что запущено». */
export const resetOnboardingStore = () => {
  generation += 1;
  useOnboardingStore.setState({ survey: 'unknown', location: 'unknown', error: null });
};
