import type { SubmitOnboardingSurveyRequest } from '@pokatim/contracts';
import { useMutation } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { api } from '@/lib/api';

import { useOnboardingStore } from './onboarding-store';

/**
 * Ответ опроса «Что вас привело?»: запрос под access (`withAccessToken`), офлайн — сразу ошибка с повтором
 * (`networkMode: 'always'`). Успех — шаг пройден: гард ведёт дальше (геопозиция или Главная).
 */
export function useSubmitSurvey() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: SubmitOnboardingSurveyRequest) =>
      withAccessToken((token) => api.submitOnboardingSurvey(token, body)),
    onSuccess: () => useOnboardingStore.getState().completeSurvey(),
  });
}
