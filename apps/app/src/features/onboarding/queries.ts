import type { SubmitOnboardingSurveyRequest } from '@pokatim/contracts';
import { useMutation } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { sessionOwner } from '@/features/auth/session-identity';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { useOnboardingStore } from './onboarding-store';

/**
 * Ответ опроса «Что вас привело?»: запрос под access (`withAccessToken`), офлайн — сразу ошибка с повтором
 * (`networkMode: 'always'`). Успех — шаг пройден: гард ведёт дальше (геопозиция или Главная).
 */
export function useSubmitSurvey() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: async (body: SubmitOnboardingSurveyRequest) => {
      // ответ принадлежит аккаунту, от имени которого ушёл запрос: сессия сменилась — шаг не засчитывается
      const owner = sessionOwner(useSessionStore.getState().session);
      const status = await withAccessToken((token) => api.submitOnboardingSurvey(token, body));
      await useOnboardingStore.getState().completeSurvey(owner);
      return status;
    },
  });
}
