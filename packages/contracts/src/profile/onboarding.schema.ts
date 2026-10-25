import { z } from 'zod';

import { fieldError } from '../common.ts';

/**
 * Коды ответа «Что вас привело?» в порядке экрана. Значения только добавляются в конец: старые сборки шлют
 * известные им коды (R7). Убрать вариант из UI — скрыть в приложении, enum не трогать.
 */
export const RIDE_REASONS = ['races', 'group_rides', 'routes', 'calendar', 'exploring'] as const;
export const RideReason = z.enum(RIDE_REASONS, { error: fieldError('INVALID') });
export type RideReason = z.infer<typeof RideReason>;

/** `PUT /v1/profile/onboarding/survey` — ответ опроса: 1…N разных кодов. Повтор перезаписывает ответ. */
export const SubmitOnboardingSurveyRequest = z.strictObject({
  reasons: z
    .array(RideReason, { error: fieldError('REQUIRED') })
    .min(1, { error: 'REQUIRED' })
    .max(RIDE_REASONS.length, { error: 'INVALID' })
    .refine((list) => new Set(list).size === list.length, { error: 'INVALID' }),
});
export type SubmitOnboardingSurveyRequest = z.infer<typeof SubmitOnboardingSurveyRequest>;

/**
 * Ответ `GET /v1/profile/onboarding` и `PUT …/survey` (под `AuthGuard`, `no-store`). Сами ответы опроса наружу
 * не отдаются: новые коды enum не ломают разбор старыми клиентами.
 */
export const OnboardingStatus = z.object({
  surveyCompleted: z.boolean(),
  /**
   * Шаг «Подключите устройство» пройден (флаг аккаунта, R12). Необязательно: старый API поля не знает — приложение
   * шаг не показывает.
   */
  devicesStepCompleted: z.boolean().optional(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

/** `PUT /v1/profile/onboarding/devices` → `OnboardingStatus`: любой исход шага отмечает его пройденным. */
export const CompleteDevicesStepRequest = z.strictObject({
  outcome: z.enum(['connected', 'later']),
});
export type CompleteDevicesStepRequest = z.infer<typeof CompleteDevicesStepRequest>;
