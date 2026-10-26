import {
  RIDE_MODERATION_STATES,
  type RideModerationState,
  type RideStatus,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

/** Вкладка очереди из URL (`?state=open|hidden`); прочее — `open`. */
export interface RidesModerationSearch {
  state?: RideModerationState;
}

export function validateRidesModerationSearch(
  search: Record<string, unknown>,
): RidesModerationSearch {
  return RIDE_MODERATION_STATES.includes(search.state as RideModerationState) &&
    search.state !== 'open'
    ? { state: search.state as RideModerationState }
    : {};
}

/** Тон статуса райда: опубликован — успех, отменён — нейтральный, скрыт — ошибка. */
export const RIDE_STATUS_TONE: Record<RideStatus, 'success' | 'neutral' | 'error'> = {
  published: 'success',
  cancelled: 'neutral',
  hidden: 'error',
};

export const rideStatusLabel = (status: RideStatus) => t(`admin.ridesModeration.status.${status}`);
