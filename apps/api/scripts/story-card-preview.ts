/**
 * Превью карточек для сторис (story-cards), приглашений кофе-райда (все темы × оба шаблона) и OG-картинок публичных
 * страниц (og-images: 4 вида с линией/без, длинные тексты, бренд — тема OG) на синтетических данных → PNG в каталог.
 * Запуск: `pnpm --filter @pokatim/api preview:story-cards <каталог> [og]` (`og` — только OG-картинки; файлы не
 * коммитятся — артефакты ревью вёрстки).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { APP_THEME_IDS, STORY_CARD_TEMPLATES, type LonLat } from '@pokatim/contracts';

import { OG_FIXTURES, ogFixture } from '../test/og-fixtures';
import { OG_THEME_ID, type OgCardInput } from '../src/modules/sharing/og-card.inputs';
import { renderOgCard } from '../src/modules/sharing/og-card.png';
import type { RideInviteInput } from '../src/modules/sharing/ride-invite.inputs';
import { renderRideInvite } from '../src/modules/sharing/ride-invite.png';
import type { StoryCardInput } from '../src/modules/sharing/story-card.inputs';
import { renderStoryCard } from '../src/modules/sharing/story-card.png';

/** Петля по Минску с «хвостом»: ≈ 600 точек (проверка упрощения до лимита). */
function syntheticLine(): LonLat[] {
  const line: LonLat[] = [];
  for (let i = 0; i <= 600; i += 1) {
    const a = (i / 600) * 2 * Math.PI;
    line.push([27.55 + 0.12 * Math.cos(a) + 0.02 * Math.sin(5 * a), 53.9 + 0.06 * Math.sin(a)]);
  }
  return line;
}

const cases: { name: string; facts: Partial<StoryCardInput['facts']>; riderName: string | null }[] =
  [
    { name: 'base', facts: {}, riderName: 'Анна Ковалёва' },
    {
      name: 'long',
      facts: {
        race: {
          title:
            'Гравийный марафон «Белорусское Поозерье» — большая петля через три озера и обратно',
          windowStartsAt: new Date('2026-09-27T21:00:00Z'),
          windowEndsAt: new Date('2026-10-03T20:59:00Z'),
          routeId: null,
        },
        elapsedSec: 36_061,
        place: 12,
        tied: true,
        status: 'provisional',
        provisional: true,
        group: 'w_40_49',
      },
      riderName: 'Александра Константинопольская-Вишневецкая',
    },
    {
      name: 'finisher',
      facts: { place: null, status: 'finisher', provisional: true },
      riderName: null,
    },
  ];

const inviteFacts: RideInviteInput['facts'] = {
  rideId: 'preview',
  title: 'Кофе-райд на Минское море',
  startsAt: new Date('2026-10-04T07:00:00Z'),
  place: 'у Дворца спорта, пр. Победителей',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  routeId: 'route',
};

const inviteCases: { name: string; facts: Partial<RideInviteInput['facts']>; line: boolean }[] = [
  { name: 'base', facts: {}, line: true },
  {
    name: 'long',
    facts: {
      title: 'Длинный кофе-райд через три озера, два леса и обратно к кофейне на берегу моря',
      place: 'парковка у главного входа в Парк Победы со стороны проспекта Победителей, у фонтана',
      distanceKm: 112.5,
      paceMinKmh: 27,
      paceMaxKmh: 27,
      routeId: null,
    },
    line: false,
  },
];

/** OG-картинки: вид × линия × длина текстов (тема — `OG_THEME_ID`, как у выдачи). */
const ogCases: { name: string; input: OgCardInput; line: boolean }[] = [
  { name: 'race-line', input: OG_FIXTURES.race, line: true },
  {
    name: 'race-long-line',
    input: ogFixture('race', {
      title: 'Гравийный марафон «Белорусское Поозерье» — большая петля через три озера и обратно',
      bikeClass: 'gravel',
      distanceKm: 162.5,
      windowStartsAt: new Date('2026-09-27T21:00:00Z'),
      windowEndsAt: new Date('2026-10-03T20:59:00Z'),
    }),
    line: true,
  },
  { name: 'race-announce', input: ogFixture('race', { routeId: null }), line: false },
  { name: 'ride-noline', input: OG_FIXTURES.ride, line: false },
  {
    name: 'ride-long-noline',
    input: ogFixture('ride', {
      title: 'Длинный кофе-райд через три озера, два леса и обратно к кофейне на берегу моря',
      place: 'парковка у главного входа в Парк Победы со стороны проспекта Победителей, у фонтана',
      distanceKm: 112.5,
      paceMinKmh: 27,
      paceMaxKmh: 27,
    }),
    line: false,
  },
  { name: 'ride-line', input: ogFixture('ride', { routeId: 'route' }), line: true },
  { name: 'route-line', input: OG_FIXTURES.route, line: true },
  {
    name: 'route-long-line',
    input: ogFixture('route', {
      title: 'Большое гравийное кольцо Нарочанского края с подъёмами на Голубые горы',
      elevationGainM: null,
      isLoop: false,
      city: 'molodechno',
    }),
    line: true,
  },
  { name: 'calendar', input: OG_FIXTURES.calendar, line: false },
  {
    name: 'calendar-long',
    input: ogFixture('calendar', {
      title:
        'Международная многодневная велогонка «Кубок Беловежской пущи» памяти основателей клуба',
      startsOn: '2026-12-30',
      endsOn: '2027-01-02',
      city: 'Каменец (Беловежская пуща)',
      distancesKm: [40, 80, 120, 160],
    }),
    line: false,
  },
  { name: 'brand', input: OG_FIXTURES.brand, line: false },
];

async function og(dir: string) {
  for (const c of ogCases) {
    const started = Date.now();
    const input = { ...c.input, themeId: OG_THEME_ID } as OgCardInput;
    const png = await renderOgCard(input, c.line ? syntheticLine() : null);
    const file = join(dir, `og-${c.name}.png`);
    await writeFile(file, png);
    process.stdout.write(`${file} ${png.byteLength} B ${Date.now() - started} ms\n`);
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: story-card-preview <out dir> [og]');
  await mkdir(dir, { recursive: true });
  await og(dir);
  if (process.argv[3] === 'og') return;
  for (const themeId of APP_THEME_IDS) {
    for (const template of STORY_CARD_TEMPLATES) {
      for (const c of cases) {
        const input: StoryCardInput = {
          template,
          themeId,
          riderName: c.riderName,
          facts: {
            entryId: 'preview',
            race: {
              title: 'Минская сотка',
              windowStartsAt: new Date('2026-10-03T21:00:00Z'),
              windowEndsAt: new Date('2026-10-12T20:59:00Z'),
              routeId: null,
            },
            status: 'final',
            provisional: false,
            elapsedSec: 9_754,
            place: 3,
            tied: false,
            group: 'm_u40',
            attempt: null,
            ...c.facts,
          },
        };
        const started = Date.now();
        const png = await renderStoryCard(input, c.name === 'finisher' ? null : syntheticLine());
        const file = join(dir, `${themeId}-${template}-${c.name}.png`);
        await writeFile(file, png);
        process.stdout.write(`${file} ${png.byteLength} B ${Date.now() - started} ms\n`);
      }
      for (const c of inviteCases) {
        const input: RideInviteInput = { template, themeId, facts: { ...inviteFacts, ...c.facts } };
        const png = await renderRideInvite(input, c.line ? syntheticLine() : null);
        const file = join(dir, `${themeId}-${template}-invite-${c.name}.png`);
        await writeFile(file, png);
        process.stdout.write(`${file} ${png.byteLength} B\n`);
      }
    }
  }
}

void main();
