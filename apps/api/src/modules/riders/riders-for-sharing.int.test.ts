import { PublicRiderProfile } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { patchProfile, publicRider } from '../../../test/profiles';
import { rider } from '../../../test/rides';
import {
  dqRow,
  placedRow,
  seedFinisher,
  seedProtocolRace,
  seedSeason,
} from '../../../test/standings';
import { RIDERS_FOR_SHARING, type RidersForSharing } from './index';

/**
 * Порт OG-картинки профиля райдера (og-rider-season-dark, S3, RC-3a): только публичный профиль (имя + согласие),
 * статистика — та же сводка, что у `GET /v1/riders/:publicId`; без имени, клуба, фото и `userId` (D-B2).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const port = () => h.app.get<RidersForSharing>(RIDERS_FOR_SHARING);

describe('RidersForSharing.ogFacts', () => {
  it('публичный: гонки = финиши, подиумы, лучшее место — как stats публичного профиля; только 4 ключа', async () => {
    const anna = await publicRider(h, 'anna@example.by');
    const season = await seedSeason(h);
    await seedProtocolRace(h, season, [placedRow(anna.userId, 2)]);
    await seedProtocolRace(h, season, [placedRow(anna.userId, 5)]);
    await seedProtocolRace(h, season, [dqRow(anna.userId)]);
    await seedFinisher(h, await seedProtocolRace(h, season, []), anna.userId);

    const facts = await port().ogFacts(anna.publicId);
    const page = PublicRiderProfile.parse(
      (await call(h, 'GET', `/v1/riders/${anna.publicId}`)).body,
    );
    expect(facts).toEqual({
      publicId: anna.publicId,
      races: page.stats.finishes,
      podiums: page.stats.podiums,
      bestPlace: page.stats.bestPlace,
    });
    expect(facts).toEqual({ publicId: anna.publicId, races: 3, podiums: 1, bestPlace: 2 });
    expect(Object.keys(facts ?? {}).sort()).toEqual(['bestPlace', 'podiums', 'publicId', 'races']);
    const text = JSON.stringify(facts);
    for (const pii of [anna.userId, 'Анна К.', 'Velo Minsk']) expect(text).not.toContain(pii);
  });

  it('публичный без гонок — нули и без лучшего места', async () => {
    const anna = await publicRider(h, 'anna@example.by');
    expect(await port().ogFacts(anna.publicId)).toEqual({
      publicId: anna.publicId,
      races: 0,
      podiums: 0,
      bestPlace: null,
    });
  });

  it('без согласия, без имени, неизвестный — null', async () => {
    const anna = await publicRider(h, 'anna@example.by');
    const boris = await publicRider(h, 'boris@example.by', 'Борис');
    await patchProfile(h, anna, { showNameInResults: false });
    await patchProfile(h, boris, { publicName: null });
    await rider(h, 'nobody@example.by');
    for (const publicId of [anna.publicId, boris.publicId, 'z'.repeat(43)]) {
      expect(await port().ogFacts(publicId)).toBeNull();
    }
  });
});
