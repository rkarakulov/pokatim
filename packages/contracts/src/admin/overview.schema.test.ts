import { describe, expect, it } from 'vitest';

import { PanelOverview } from './overview.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('PanelOverview', () => {
  it('организатор: только протоколы и «Сейчас идёт» — остальных блоков нет', () => {
    const parsed = PanelOverview.parse({
      attention: { protocols: { awaiting: 1, ready: 0, blockers: 2 } },
      live: {
        racesTotal: 1,
        races: [
          {
            id: ID,
            title: 'Гонка',
            windowEndsAt: '2026-10-30T18:00:00.000Z',
            participants: 3,
            attempts: 2,
          },
        ],
        calendar: [{ id: ID, title: 'Старт', startsOn: '2026-11-01', endsOn: null, city: 'Минск' }],
      },
    });
    expect(parsed.attention.disputes).toBeUndefined();
    expect(parsed.kpi).toBeUndefined();
  });

  it('admin: все блоки; ноль — допустимое значение', () => {
    expect(
      PanelOverview.safeParse({
        attention: {
          disputes: { open: 0 },
          protocols: { awaiting: 0, ready: 0, blockers: 0 },
          rides: { reported: 0 },
          riderRoutes: { pending: 0, reported: 0 },
          riderProfiles: { reported: 0 },
          accountDeletions: { stuck: 0 },
        },
        live: { racesTotal: 0, races: [], calendar: [] },
        kpi: { newUsers: 0, uploads: 0, activeRides: 0 },
      }).success,
    ).toBe(true);
  });

  it('отрицательный или дробный счётчик — ошибка формы ответа', () => {
    expect(PanelOverview.safeParse({ attention: { rides: { reported: -1 } } }).success).toBe(false);
    expect(PanelOverview.safeParse({ attention: { rides: { reported: 1.5 } } }).success).toBe(false);
  });
});
