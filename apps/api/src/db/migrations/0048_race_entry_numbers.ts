import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { AnyBulkWriteOperation } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';

interface EntryNumberDoc {
  _id: string;
  raceId: string;
  createdAt: Date;
  entryNo?: number;
}

/**
 * Номера заявок в гонке (name-consent-prompt, N7): бэкфилл `race_entries.entryNo`. Гонка без номеров — 1…N по
 * `(createdAt, _id)`; гонка, где часть заявок уже с номером (старый API в окне деплоя), — недостающим номера после
 * `max(entryAdmissions, наибольший номер)`. Счётчик гонки — `$max` до последнего выданного: новая заявка получит
 * следующий номер (`admitEntry` + 1). Expand-only, без транзакции, идемпотентна (условие — нет `entryNo`), индексов
 * нет. После `0047_ride_photos`.
 */
export const raceEntryNumbers: MongoMigration = {
  id: '0048_race_entry_numbers',
  async up(db) {
    const entries = db.collection<EntryNumberDoc>(RESULTS_COLLECTIONS.entries);
    const races = db.collection<{ _id: string; entryAdmissions?: number }>(RACES_COLLECTIONS.races);
    const raceIds = await entries.distinct('raceId', { entryNo: { $exists: false } });
    for (const raceId of raceIds) {
      const docs = await entries
        .find({ raceId }, { projection: { _id: 1, createdAt: 1, entryNo: 1 } })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
      const numbered = docs.flatMap((doc) =>
        typeof doc.entryNo === 'number' ? [doc.entryNo] : [],
      );
      const race = await races.findOne({ _id: raceId }, { projection: { entryAdmissions: 1 } });
      let next = numbered.length === 0 ? 1 : Math.max(race?.entryAdmissions ?? 0, ...numbered) + 1;
      const writes: AnyBulkWriteOperation<EntryNumberDoc>[] = [];
      for (const doc of docs) {
        if (typeof doc.entryNo === 'number') continue;
        writes.push({
          updateOne: {
            filter: { _id: doc._id, entryNo: { $exists: false } },
            update: { $set: { entryNo: next } },
          },
        });
        next += 1;
      }
      if (writes.length > 0) await entries.bulkWrite(writes, { ordered: false });
      await races.updateOne({ _id: raceId }, { $max: { entryAdmissions: next - 1 } });
    }
  },
};
