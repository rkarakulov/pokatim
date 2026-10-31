import type { RideParticipants, RideRiderGroup } from '@pokatim/contracts';

import type { PublicRiderCard } from '../profile';
import type { SocialRideFacts } from '../rides';
import type { AttendanceEntry } from './social.collection';
import { attendanceCheck } from './social.policy';

/** Группа райдеров (K3, K4): публичные — строками в порядке `userIds`, остальные — числом. Явный список полей, без `userId`. */
function riderGroup(
  userIds: readonly string[],
  cards: ReadonlyMap<string, PublicRiderCard>,
): RideRiderGroup {
  const riders = userIds.flatMap((userId) => {
    const card = cards.get(userId);
    return card
      ? [
          {
            name: card.name,
            publicId: card.publicId,
            avatar: card.avatarId ? { id: card.avatarId } : null,
          },
        ]
      : [];
  });
  return { riders, hiddenCount: userIds.length - riders.length };
}

/**
 * Ответ `GET rides/:id/participants` (P2, K4, K5): участники «Иду» (организатор первым), явка зрителя-участника и
 * «Ехали N» (только при явке зрителя; порядок — участники райда, не записи явки). Флаги — `attendanceCheck` (RC-3).
 */
export function rideParticipantsView(
  facts: SocialRideFacts,
  entries: readonly AttendanceEntry[],
  cards: ReadonlyMap<string, PublicRiderCard>,
  viewerId: string,
  now: Date,
): RideParticipants {
  const group = riderGroup(facts.participantIds, cards);
  if (!facts.participantIds.includes(viewerId)) return { ...group, attendance: null };
  const own = entries.find((entry) => entry.userId === viewerId);
  const state = !own ? 'none' : own.declinedAt === null ? 'attended' : 'declined';
  const open = attendanceCheck(facts, viewerId, now) === null;
  const present = new Set(
    entries.filter((entry) => entry.declinedAt === null).map((entry) => entry.userId),
  );
  return {
    ...group,
    attendance: {
      state,
      canMark: open && state !== 'attended',
      canDecline: open && state !== 'declined',
      attended:
        state === 'attended'
          ? riderGroup(
              facts.participantIds.filter((userId) => present.has(userId)),
              cards,
            )
          : null,
    },
  };
}
