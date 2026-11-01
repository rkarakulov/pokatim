import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  publicationDoc,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { seedTeamRoute } from '../../../test/rides';
import { ROUTES_FOR_SOCIAL, type RoutesForSocial } from './index';

/** Порт «Респекта автору» (P4, RC-P4-5): только маршрут райдера в каталоге; автор наружу — только через порт. */
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

const port = () => h.app.get<RoutesForSocial>(ROUTES_FOR_SOCIAL);
const RIDER = '01890a5d-0000-7000-8000-0000000000bb';

describe('respectTarget', () => {
  it('одобренный маршрут райдера в каталоге — автор', async () => {
    const id = await seedApprovedRiderRoute(h, RIDER);
    expect(await port().respectTarget(id)).toEqual({ routeId: id, authorUserId: RIDER });
  });

  it('команды, заявка, скрытый, свой без публикации, снятый, удалённый, неизвестный — null', async () => {
    const team = await seedTeamRoute(h);
    const pending = await seedRiderRoute(h, RIDER, { publication: publicationDoc(h, 'pending') });
    const hidden = await seedRiderRoute(h, RIDER, { publication: publicationDoc(h, 'hidden') });
    const own = await seedRiderRoute(h, RIDER);
    const removed = await seedApprovedRiderRoute(h, RIDER);
    await routesDb(h).routes.updateOne({ _id: removed }, { $set: { catalog: null } });
    const deleted = await seedApprovedRiderRoute(h, RIDER);
    await routesDb(h).routes.deleteOne({ _id: deleted });
    for (const id of [team, pending, hidden, own, removed, deleted, uuidv7()]) {
      expect(await port().respectTarget(id)).toBeNull();
    }
  });
});
