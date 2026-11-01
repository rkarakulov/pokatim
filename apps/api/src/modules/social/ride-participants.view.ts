import type {
  RideAttendedRow,
  RideParticipants,
  RideRiderGroup,
  RideRiderRow,
} from '@pokatim/contracts';

import type { PublicRiderCard } from '../profile';
import type { SocialRideFacts } from '../rides';
import type { AttendanceEntry } from './social.collection';
import { attendanceCheck } from './social.policy';

/** Публичные строки в порядке `userIds` с полями строки от `extra`, остальные — числом; без `userId`. */
function groupOf<Extra extends object>(
  userIds: readonly string[],
  cards: ReadonlyMap<string, PublicRiderCard>,
  extra: (userId: string) => Extra,
): { riders: (RideRiderRow & Extra)[]; hiddenCount: number } {
  const riders = userIds.flatMap((userId) => {
    const card = cards.get(userId);
    return card
      ? [
          {
            name: card.name,
            publicId: card.publicId,
            avatar: card.avatarId ? { id: card.avatarId } : null,
            ...extra(userId),
          },
        ]
      : [];
  });
  return { riders, hiddenCount: userIds.length - riders.length };
}

/**
 * Группа райдеров (K3, K4): публичные — строками в порядке `userIds`, остальные — числом. Явный список полей, без
 * `userId`. Общая для участников райда и поставивших «Респект» (P4).
 */
export function riderGroup(
  userIds: readonly string[],
  cards: ReadonlyMap<string, PublicRiderCard>,
): RideRiderGroup {
  return groupOf(userIds, cards, () => ({}));
}

/**
 * Ответ `GET rides/:id/participants` (P2, K4, K5): участники «Иду» (организатор первым), явка зрителя-участника и
 * «Ехали N» (только при явке зрителя; порядок — участники райда, не записи явки). Флаги — `attendanceCheck` (RC-3).
 * «Спасибо за компанию» (P4, RC-P4-7, RC-P4-8): строка «Ехали» — `self` и `thanked` (`thanked` — получатели «спасибо»
 * зрителя на этом райде); `allThanked` — поблагодарены все явившиеся «Ехали N», кроме зрителя (скрытые тоже; нет
 * других — `true`).
 */
export function rideParticipantsView(
  facts: SocialRideFacts,
  entries: readonly AttendanceEntry[],
  cards: ReadonlyMap<string, PublicRiderCard>,
  viewerId: string,
  now: Date,
  thanked: ReadonlySet<string> = new Set(),
): RideParticipants {
  const group = riderGroup(facts.participantIds, cards);
  if (!facts.participantIds.includes(viewerId)) return { ...group, attendance: null };
  const own = entries.find((entry) => entry.userId === viewerId);
  const state = !own ? 'none' : own.declinedAt === null ? 'attended' : 'declined';
  const open = attendanceCheck(facts, viewerId, now) === null;
  const present = new Set(
    entries.filter((entry) => entry.declinedAt === null).map((entry) => entry.userId),
  );
  const attendedIds = facts.participantIds.filter((userId) => present.has(userId));
  const attended =
    state === 'attended'
      ? groupOf(attendedIds, cards, (userId): Pick<RideAttendedRow, 'self' | 'thanked'> => ({
          self: userId === viewerId,
          thanked: thanked.has(userId),
        }))
      : null;
  return {
    ...group,
    attendance: {
      state,
      canMark: open && state !== 'attended',
      canDecline: open && state !== 'declined',
      attended,
      allThanked:
        attended !== null &&
        attendedIds.every((userId) => userId === viewerId || thanked.has(userId)),
    },
  };
}
