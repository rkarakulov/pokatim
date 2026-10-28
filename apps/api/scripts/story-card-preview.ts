/**
 * Превью карточек для сторис (story-cards) на синтетических данных: все темы × оба шаблона → PNG в каталог.
 * Запуск: `pnpm --filter @pokatim/api preview:story-cards <каталог>` (файлы не коммитятся — артефакты ревью вёрстки).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { APP_THEME_IDS, STORY_CARD_TEMPLATES, type LonLat } from '@pokatim/contracts';

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

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: story-card-preview <out dir>');
  await mkdir(dir, { recursive: true });
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
    }
  }
}

void main();
