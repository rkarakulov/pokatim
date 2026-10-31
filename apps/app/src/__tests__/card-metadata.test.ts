/// <reference types="jest" />
import { generateMetadata as achievementStory } from '../app/achievements/story/[code]';
import { generateMetadata as raceStory } from '../app/races/story/[id]';
import { generateMetadata as rideInvite } from '../app/rides/invite/[id]';
import { generateMetadata as routeStory } from '../app/routes/story/[id]';

const ID = '0190a6f4-0000-7000-8000-000000000001';
const request = new Request('https://pokatim.by/');

// SSR web: служебные экраны карточек — нейтральная мета без данных объекта и `noindex` (страховка к `Disallow`)
describe('мета экранов карточек для сторис', () => {
  it.each([
    ['приглашение райда', rideInvite, { id: ID }, 'Карточка-приглашение — Покатим'],
    ['сторис результата', raceStory, { id: ID }, 'Карточка для сторис — Покатим'],
    ['карточка маршрута', routeStory, { id: ID }, 'Карточка маршрута — Покатим'],
    [
      'карточка достижения',
      achievementStory,
      { code: 'race_win' },
      'Карточка достижения — Покатим',
    ],
  ])('%s — noindex, без og:url', async (_name, generate, params, title) => {
    const meta = await generate(request, params);
    expect(meta).toMatchObject({ title, robots: 'noindex' });
    expect(JSON.stringify(meta)).not.toContain(ID);
    expect(meta.openGraph).not.toHaveProperty('url');
  });
});
