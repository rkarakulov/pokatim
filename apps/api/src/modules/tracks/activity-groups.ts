import type { DbSession } from '../../db';
import type { ActivityDoc, ActivityTrackDoc } from './tracks.collection';
import { isSameRide, pickPrimary } from './tracks.policy';
import type { TracksRepository } from './tracks.repository';

/**
 * Вставка активности с группировкой дублей (R7) — внутри транзакции, **после** `lockUserActivities`: кандидаты со
 * стартом ±180 с и длительностью ±5 % (другой источник), их группы сливаются, основная — по приоритету
 * `pickPrimary`; статусы загрузок группы — `ready`/`duplicate`. Возвращает id основной.
 */
export async function insertGrouped(
  repository: TracksRepository,
  session: DbSession,
  activity: ActivityDoc,
  track: ActivityTrackDoc | null,
  now: Date,
): Promise<string> {
  const candidates = (
    await repository.dedupCandidates(session, activity.userId, activity.startedAt)
  )
    .filter((candidate) => candidate._id !== activity._id)
    .filter((candidate) => isSameRide(activity, candidate));
  const roots = [...new Set(candidates.map((candidate) => candidate.duplicateOf ?? candidate._id))];
  const members =
    roots.length === 0 ? [] : await repository.groupMembers(session, activity.userId, roots);
  const group = [...members, activity];
  const primary = pickPrimary(group);
  await repository.insertActivity(
    session,
    { ...activity, duplicateOf: primary._id === activity._id ? null : primary._id },
    track,
  );
  await repository.applyGroup(session, group, primary._id, now);
  return primary._id;
}

/**
 * Удалена основная активность: из её дублей выбирается новая основная (под тем же замком). Возвращает id новой
 * основной; удалён дубль или дублей не было — `null`.
 */
export async function regroupAfterDelete(
  repository: TracksRepository,
  session: DbSession,
  removed: ActivityDoc,
  now: Date,
): Promise<string | null> {
  if (removed.duplicateOf !== null) return null;
  const rest = await repository.duplicatesOf(session, removed._id);
  if (rest.length === 0) return null;
  const primaryId = pickPrimary(rest)._id;
  await repository.applyGroup(session, rest, primaryId, now);
  return primaryId;
}
