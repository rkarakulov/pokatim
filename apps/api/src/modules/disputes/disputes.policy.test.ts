import { describe, expect, it } from 'vitest';

import type { RaceForResults } from '../races';
import type { DisputeEntry } from '../results';
import {
  decidableAt,
  decideBlock,
  fileBlock,
  filingClosesAt,
  filingStatus,
  targetBlock,
} from './disputes.policy';

const HOUR = 3_600_000;
const PLANNED = new Date('2026-10-30T20:59:00Z');
const CUTOFF = new Date(PLANNED.getTime() - 24 * HOUR);
const BEFORE = new Date(CUTOFF.getTime() - HOUR);

const race = (overrides: Partial<RaceForResults> = {}): RaceForResults => ({
  id: 'race',
  ownerUserId: 'owner',
  status: 'published',
  title: 'Коридор',
  windowStartsAt: new Date('2026-10-23T21:00:00Z'),
  windowEndsAt: new Date('2026-10-26T20:59:00Z'),
  closesAt: new Date('2026-10-26T21:00:00Z'),
  protocolPlannedAt: PLANNED,
  corridor: { routeId: 'route', widthM: 50, distanceM: 8000 },
  lockedAt: null,
  groupScheme: 'gender_age',
  protocolPublishedAt: null,
  disputeFilingClosedAt: null,
  ...overrides,
});

const entry = (overrides: Partial<DisputeEntry> = {}): DisputeEntry => ({
  id: 'mine',
  raceId: 'race',
  userId: 'me',
  groupKey: 'overall',
  status: 'active',
  best: { elapsedSec: 3600, startedAt: new Date('2026-10-25T06:00:00Z') },
  disqualified: false,
  tier: 'verified',
  ranked: true,
  ...overrides,
});

describe('сроки (D-44, D-25)', () => {
  it('filingClosesAt: плановая − 24 ч; зафиксированная (RC-7) важнее', () => {
    expect(filingClosesAt(race())).toEqual(CUTOFF);
    const frozen = new Date('2026-10-28T00:00:00Z');
    expect(filingClosesAt(race({ disputeFilingClosedAt: frozen }))).toEqual(frozen);
  });

  it('decidableAt: подача + 12 ч', () => {
    const filed = new Date('2026-10-25T10:00:00Z');
    expect(decidableAt(filed)).toEqual(new Date('2026-10-25T22:00:00Z'));
  });
});

describe('fileBlock — порядок причин', () => {
  const ok = { race: race(), now: BEFORE, complainant: entry(), openByComplainant: 0 };

  it('годен — null; граница now = closesAt — filing_closed', () => {
    expect(fileBlock(ok)).toBeNull();
    expect(fileBlock({ ...ok, now: CUTOFF })).toBe('filing_closed');
    expect(fileBlock({ ...ok, now: new Date(CUTOFF.getTime() - 1) })).toBeNull();
  });

  it('cancelled → protocol_published → not_entered → withdrawn → disqualified → no_counted_result → filing_closed → open_limit', () => {
    const all = {
      race: race({ status: 'cancelled', protocolPublishedAt: BEFORE }),
      now: CUTOFF,
      complainant: null,
      openByComplainant: 3,
    };
    expect(fileBlock(all)).toBe('cancelled');
    expect(fileBlock({ ...all, race: race({ protocolPublishedAt: BEFORE }) })).toBe(
      'protocol_published',
    );
    expect(fileBlock({ ...all, race: race() })).toBe('not_entered');
    const c = { ...all, race: race() };
    expect(
      fileBlock({
        ...c,
        complainant: entry({ status: 'withdrawn', disqualified: true, best: null }),
      }),
    ).toBe('withdrawn');
    expect(fileBlock({ ...c, complainant: entry({ disqualified: true, best: null }) })).toBe(
      'disqualified',
    );
    expect(fileBlock({ ...c, complainant: entry({ best: null, ranked: false }) })).toBe(
      'no_counted_result',
    );
    // race-results-07: START или Verified без пульса — результат без места
    expect(fileBlock({ ...c, complainant: entry({ ranked: false }) })).toBe('not_ranked');
    expect(fileBlock({ ...c, complainant: entry({ tier: 'start', ranked: false }) })).toBe(
      'not_ranked',
    );
    expect(fileBlock({ ...c, complainant: entry() })).toBe('filing_closed');
    expect(fileBlock({ ...c, now: BEFORE, complainant: entry() })).toBe('open_limit');
    expect(fileBlock({ ...c, now: BEFORE, complainant: entry(), openByComplainant: 2 })).toBeNull();
  });
});

describe('filingStatus (RC-10)', () => {
  it('open / closed (M1) / unavailable', () => {
    expect(filingStatus(null)).toBe('open');
    for (const block of ['filing_closed', 'protocol_published', 'open_limit'] as const) {
      expect(filingStatus(block)).toBe('closed');
    }
    for (const block of [
      'not_entered',
      'withdrawn',
      'no_counted_result',
      'disqualified',
      'cancelled',
      'not_ranked',
    ] as const) {
      expect(filingStatus(block)).toBe('unavailable');
    }
  });
});

describe('targetBlock', () => {
  const mine = entry();
  it('своя — own_result; чужой гонки, без best, DQ, отменённая, нет — target_not_counted', () => {
    expect(targetBlock(mine, entry({ id: 'other', userId: 'u2' }), 'race')).toBeNull();
    expect(targetBlock(mine, mine, 'race')).toBe('own_result');
    expect(targetBlock(mine, null, 'race')).toBe('target_not_counted');
    expect(targetBlock(mine, entry({ id: 'o', raceId: 'other' }), 'race')).toBe(
      'target_not_counted',
    );
    expect(targetBlock(mine, entry({ id: 'o', best: null }), 'race')).toBe('target_not_counted');
    expect(targetBlock(mine, entry({ id: 'o', disqualified: true }), 'race')).toBe(
      'target_not_counted',
    );
    expect(targetBlock(mine, entry({ id: 'o', status: 'withdrawn' }), 'race')).toBe(
      'target_not_counted',
    );
  });

  it('race-results-07: цель без места (START, без пульса) и другой группы — target_not_counted', () => {
    expect(targetBlock(mine, entry({ id: 'o', ranked: false }), 'race')).toBe('target_not_counted');
    expect(
      targetBlock(
        mine,
        entry({ id: 'o', tier: 'start', groupKey: 'overall', ranked: false }),
        'race',
      ),
    ).toBe('target_not_counted');
    const group = entry({ groupKey: 'm_40_49' });
    expect(targetBlock(group, entry({ id: 'o', groupKey: 'm_u40' }), 'race')).toBe(
      'target_not_counted',
    );
    expect(targetBlock(group, entry({ id: 'o', groupKey: 'm_40_49' }), 'race')).toBeNull();
  });
});

describe('decideBlock', () => {
  const filedAt = new Date('2026-10-25T10:00:00Z');
  const ready = decidableAt(filedAt);
  const open = { status: 'open' as const, filedAt };

  it('закрыт → отменена → опубликована → рано (граница 12 ч — можно)', () => {
    expect(decideBlock(open, race(), ready)).toBeNull();
    expect(decideBlock(open, race(), new Date(ready.getTime() - 1))).toBe('too_early');
    expect(decideBlock(open, race({ protocolPublishedAt: ready }), ready)).toBe(
      'protocol_published',
    );
    expect(decideBlock(open, race({ status: 'cancelled' }), ready)).toBe('cancelled');
    expect(decideBlock({ ...open, status: 'upheld' }, race({ status: 'cancelled' }), ready)).toBe(
      'not_open',
    );
  });
});
