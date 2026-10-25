import { z } from 'zod';

/** Ключ флага устройства «экран геопозиции показан» (обе платформы, `device-flags(.web).ts`). */
export const LOCATION_PROMPT_KEY = 'pokatim.locationPrompt';

/** Решение на экране геопозиции: «Разрешить» (системный запрос был) или «Не сейчас». Без координат и статуса ОС. */
export const LocationPromptFlag = z.object({
  decision: z.enum(['requested', 'dismissed']),
  at: z.number(),
});
export type LocationPromptDecision = z.infer<typeof LocationPromptFlag>['decision'];
