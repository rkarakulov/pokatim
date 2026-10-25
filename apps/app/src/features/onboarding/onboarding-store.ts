import { z } from 'zod';
import { create } from 'zustand';

import { api } from '@/lib/api';
import { withAccessToken } from '@/features/auth/authorized';
import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';
import { sessionOwner } from '@/features/auth/session-identity';
import { useSessionStore } from '@/features/auth/session-store';
import { getLocationPermission } from '@/features/location/location-permission';

import { hasLocationPrompt, saveLocationPrompt } from './device-flags';
import type { LocationPromptDecision } from './location-prompt';

/**
 * Шаг геопозиции в онбординге (R6): включён, пока сборки только у внутренних тестеров. Перед публикацией в сторах —
 * `false`, если фичи «рядом» ещё нет (release-чеклист `docs/runbooks/deploy.md`): запрос разрешения без потребителя
 * — риск отклонения App Review (5.1.1).
 */
export const LOCATION_STEP_ENABLED = true;

/**
 * Опрос: `unknown` — ещё не выяснили; `required` — сервер ответа не знает; `completed` — ответ есть (сервер или кеш
 * устройства); `unavailable` — выяснить не удалось (сеть, сбой API): вкладки показывают ошибку с повтором.
 */
export type SurveyState = 'unknown' | 'required' | 'completed' | 'unavailable';
/** Шаг геопозиции: `pending` — показать экран; `done` — решено (флаг устройства или решение ОС). */
export type LocationStepState = 'unknown' | 'pending' | 'done';
/**
 * Шаг «Подключите устройство» (флаг аккаунта на сервере, tracks-devices): `pending` — показать экран; `done` — пройден
 * (сервер или кеш) или пропущен (старый API без поля, статус не получен при кеше опроса — без блокировки запуска).
 */
export type DevicesStepState = 'unknown' | 'pending' | 'done';
/** Шаг онбординга для гарда: опрос → геопозиция → устройства → Главная. */
export type OnboardingStep = 'unknown' | 'survey' | 'location' | 'devices' | 'done';

/**
 * Кеш «опрос пройден» — офлайн-старт native не ждёт сервер (R4). Привязан к владельцу (`sub` access): чужой кеш
 * (выход без очистки, холодный старт с истёкшей сессией, дубликат вкладки web) не принимается и удаляется при
 * чтении; стирается и при выходе. Рядом — «шаг устройств пройден» (`devicesStepCompleted`, тот же владелец): пишется,
 * только когда сервер подтвердил шаг; без него запуск спрашивает сервер.
 */
const SURVEY_KEY = 'pokatim.onboarding';
const SurveyFlag = z.object({
  surveyCompleted: z.literal(true),
  userId: z.string().min(1),
  devicesStepCompleted: z.literal(true).optional(),
});
type CachedOnboarding = { devicesStepCompleted: boolean };

/** Владелец текущей сессии (`sub` access); нет сессии — `undefined`. */
const currentOwner = () => sessionOwner(useSessionStore.getState().session);

interface OnboardingState {
  survey: SurveyState;
  location: LocationStepState;
  devices: DevicesStepState;
  /** причина `unavailable` — «Нет соединения» или «Не удалось загрузить» */
  error: unknown;
  /** после входа (эффект корневого layout): опрос — кеш или сервер, геопозиция — флаг устройства и ОС */
  hydrate: () => Promise<void>;
  /** повтор после `unavailable`: снова «неизвестно» (скелетон) — корневой layout выясняет заново */
  retry: () => void;
  /** ответ опроса аккаунта `owner` сохранён на сервере; сессия за это время сменилась — ничего не меняет */
  completeSurvey: (owner: string | undefined) => Promise<void>;
  /** экран геопозиции пройден («Разрешить» при любом исходе или «Не сейчас»): флаг устройства, дальше — Главная */
  finishLocation: (decision: LocationPromptDecision) => Promise<void>;
  /** шаг устройств аккаунта `owner` сохранён на сервере (любой исход); сессия сменилась — ничего не меняет */
  completeDevicesStep: (owner: string | undefined) => Promise<void>;
  /** выход: состояние и кеш опроса прежнего аккаунта стираются; флаг геопозиции (устройство) остаётся */
  reset: () => Promise<void>;
}

export const onboardingStep = (
  state: Pick<OnboardingState, 'survey' | 'location' | 'devices'>,
): OnboardingStep => {
  if (state.survey === 'unknown' || state.survey === 'unavailable') return 'unknown';
  if (state.survey === 'required') return 'survey';
  if (state.location === 'unknown') return 'unknown';
  if (state.location === 'pending') return 'location';
  if (state.devices === 'unknown') return 'unknown';
  return state.devices === 'pending' ? 'devices' : 'done';
};

async function writeSurveyFlag(userId: string, devicesStepCompleted = false): Promise<void> {
  try {
    await secureStorage.set(
      SURVEY_KEY,
      JSON.stringify({
        surveyCompleted: true,
        userId,
        ...(devicesStepCompleted ? { devicesStepCompleted: true } : {}),
      }),
    );
  } catch (error) {
    // без кеша следующий запуск спросит сервер — не падение
    console.warn(`onboarding flag not persisted: ${(error as Error).name}`);
  }
}

/**
 * Опрос и шаг устройств владельца `owner`: кеш этого владельца или сервер. `isCurrent` — гидрация ещё актуальна (то же
 * поколение и тот же владелец сессии): поздний ответ после выхода или смены аккаунта кеш не пишет.
 * Шаг устройств: поле `devicesStepCompleted` отсутствует (старый API) — пропуск; кеш опроса есть, а статус не получен
 * (офлайн-старт) — пропуск на этот запуск (Главная без ожидания сети), сервер спросим при следующем.
 */
async function surveyState(
  owner: string | undefined,
  isCurrent: () => boolean,
): Promise<Pick<OnboardingState, 'survey' | 'devices' | 'error'>> {
  const cached = await readJson<CachedOnboarding>(SURVEY_KEY, (value) => {
    const flag = SurveyFlag.safeParse(value);
    // чужой или старый (без владельца) кеш — как отсутствующий: readJson его удаляет
    return flag.success && owner !== undefined && flag.data.userId === owner
      ? { devicesStepCompleted: flag.data.devicesStepCompleted === true }
      : undefined;
  });
  if (cached?.devicesStepCompleted) return { survey: 'completed', devices: 'done', error: null };
  try {
    const status = await withAccessToken((token) => api.getOnboardingStatus(token));
    const devices = status.devicesStepCompleted === false ? 'pending' : 'done';
    if (!status.surveyCompleted) return { survey: 'required', devices, error: null };
    if (owner !== undefined && isCurrent()) {
      await writeSurveyFlag(owner, status.devicesStepCompleted === true);
    }
    return { survey: 'completed', devices, error: null };
  } catch (error) {
    if (cached) return { survey: 'completed', devices: 'done', error: null };
    // 401 после обновления — сессия уже закрыта, гард ведёт на «Вход»; прочее — повтор с вкладок
    return { survey: 'unavailable', devices: 'unknown', error };
  }
}

/**
 * Шаг геопозиции: флаг устройства есть — решён (экран один раз на устройство, Q5); иначе — по разрешению ОС/браузера:
 * не определено — экран, `granted`/`denied`/`unavailable` — пропуск (решение ОС первично, флаг не пишем).
 */
async function locationState(): Promise<LocationStepState> {
  if (!LOCATION_STEP_ENABLED || (await hasLocationPrompt())) return 'done';
  return (await getLocationPermission()) === 'undetermined' ? 'pending' : 'done';
}

/** Поколение состояния: ответ гидрации, начатой до выхода, не перезаписывает сброс. */
let generation = 0;

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  survey: 'unknown',
  location: 'unknown',
  devices: 'unknown',
  error: null,
  hydrate: async () => {
    const started = (generation += 1);
    const owner = currentOwner();
    const isCurrent = () => started === generation && currentOwner() === owner;
    const [survey, location] = await Promise.all([surveyState(owner, isCurrent), locationState()]);
    if (!isCurrent()) return;
    set({ ...survey, location });
  },
  retry: () => {
    if (get().survey === 'unavailable') set({ survey: 'unknown', devices: 'unknown', error: null });
  },
  completeSurvey: async (owner) => {
    if (owner === undefined || currentOwner() !== owner) return;
    set({ survey: 'completed', error: null });
    await writeSurveyFlag(owner);
  },
  finishLocation: async (decision) => {
    await saveLocationPrompt(decision);
    set({ location: 'done' });
  },
  completeDevicesStep: async (owner) => {
    if (owner === undefined || currentOwner() !== owner) return;
    set({ devices: 'done' });
    // шаг идёт после опроса: опрос этого владельца уже пройден
    await writeSurveyFlag(owner, true);
  },
  reset: async () => {
    generation += 1;
    set({ survey: 'unknown', location: 'unknown', devices: 'unknown', error: null });
    await secureStorage.delete(SURVEY_KEY).catch(() => undefined);
  },
}));

/** Для тестов: состояние «только что запущено». */
export const resetOnboardingStore = () => {
  generation += 1;
  useOnboardingStore.setState({
    survey: 'unknown',
    location: 'unknown',
    devices: 'unknown',
    error: null,
  });
};
