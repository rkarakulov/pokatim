import type { ActivitySport, LonLat } from '@pokatim/contracts';

/**
 * Порт `tracks` для модуля `social` (автоявка, ADR-0027 п. 4, P5; через `modules/tracks/index.ts`): старт основной
 * группы дублей активности — владелец, вид спорта, время и точка старта. `social` коллекции `tracks` не читает.
 * Владение — из состояния `tracks`, не из события.
 */
export const ACTIVITY_STARTS = Symbol('ACTIVITY_STARTS');

export interface ActivityStart {
  /** основная группы дублей (`duplicateOf ?? id`) — не входная активность */
  activityId: string;
  userId: string;
  sport: ActivitySport;
  startedAt: Date;
  /** `[lon, lat]` старта основной; наружу из social не уходит и в логи не пишется */
  startPoint: LonLat;
}

export interface ActivityStarts {
  /** Старт основной группы активности сейчас; активности или основной нет — `null`. */
  primaryStart(activityId: string): Promise<ActivityStart | null>;
}
