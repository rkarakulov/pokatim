import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { SocialActionBlockedDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { retryAfterSec } from '@/features/auth/error-messages';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/**
 * Участники райда и явка зрителя («Свои» P2, K4, K5): только вошедшему, только клиентский запрос (`no-store`). Ключ —
 * под префиксом `['rides']`: «Я иду» / «Не иду» инвалидируют его вместе с карточкой (RC-9). Мутации явки — ответ в
 * кэш без инвалидации `['rides']` (райд не меняется); отказ 409/404 — перечитать участников (флаги устарели).
 */
export const rideParticipantsKey = (id: string) => ['rides', 'detail', id, 'participants'] as const;

export function useRideParticipants(id: string, enabled: boolean) {
  return useQuery({
    queryKey: rideParticipantsKey(id),
    queryFn: () => withAccessToken((accessToken) => api.rideParticipants(accessToken, id)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

export type AttendanceAction = 'mark' | 'decline';

/** «Я был на райде» / «Меня не было»: `variables` мутации — нажатое действие (состояние своей кнопки). */
export function useRideAttendance(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AttendanceAction) =>
      withAccessToken((accessToken) =>
        action === 'mark'
          ? api.markRideAttended(accessToken, id)
          : api.declineRideAttendance(accessToken, id),
      ),
    networkMode: 'always',
    onSuccess: (data) => {
      queryClient.setQueryData(rideParticipantsKey(id), data);
    },
    onError: (error) => {
      const code = apiErrorOf(error)?.code;
      if (code === 'SOCIAL_ACTION_BLOCKED' || code === 'NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: rideParticipantsKey(id) });
      }
    },
  });
}

/** Текст отказа отметки явки (под действием): сеть, лимит, райда нет, причина `SOCIAL_ACTION_BLOCKED`. */
export function attendanceErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('rides.error.network');
  const code = apiErrorOf(error)?.code;
  if (code === 'RATE_LIMITED') {
    return t('rides.error.rateLimited', { seconds: retryAfterSec(error) ?? 60 });
  }
  if (code === 'NOT_FOUND') return t('rides.detail.notFound');
  if (code === 'SOCIAL_ACTION_BLOCKED') {
    const details = SocialActionBlockedDetails.safeParse(apiErrorOf(error)?.details);
    const reason = details.success ? details.data.reason : 'unknown';
    if (
      reason === 'not_participant' ||
      reason === 'attendance_window' ||
      reason === 'ride_unavailable'
    ) {
      return t(`rides.attendance.error.${reason}`);
    }
  }
  return t('rides.attendance.error.unknown');
}

/**
 * «Спасибо за компанию» (P4, K5): `variables` — `publicId` строки или `null` («Поблагодарить всех»). Ответ — свежие
 * участники в кэш (как явка); отказ 409/404 — перечитать участников.
 */
export function useRideThanks(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicId: string | null) =>
      withAccessToken((accessToken) => api.thankRideRiders(accessToken, id, publicId ?? undefined)),
    networkMode: 'always',
    onSuccess: (data) => {
      queryClient.setQueryData(rideParticipantsKey(id), data);
    },
    onError: (error) => {
      const code = apiErrorOf(error)?.code;
      if (code === 'SOCIAL_ACTION_BLOCKED' || code === 'NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: rideParticipantsKey(id) });
      }
    },
  });
}

/** Текст отказа «спасибо» (баннер под блоком): сеть, лимит, райда или райдера нет, причина `SOCIAL_ACTION_BLOCKED`. */
export function thanksErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('rides.error.network');
  const code = apiErrorOf(error)?.code;
  if (code === 'RATE_LIMITED') {
    return t('rides.error.rateLimited', { seconds: retryAfterSec(error) ?? 60 });
  }
  // 404 «спасибо» — райдер стал непубличным или райд скрыт; карточка ещё на экране, «Райд не найден» вводит в заблуждение
  if (code === 'NOT_FOUND') return t('rides.thanks.error.not_found');
  if (code === 'SOCIAL_ACTION_BLOCKED') {
    const details = SocialActionBlockedDetails.safeParse(apiErrorOf(error)?.details);
    if (details.success && details.data.reason === 'not_attended') {
      return t('rides.thanks.error.not_attended');
    }
  }
  return t('rides.thanks.error.unknown');
}
