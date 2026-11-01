import { FAILED_JOB_ERROR_MAX } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { QUEUE } from '../../queues';
import { QUEUE_NAMES } from './failed-job-queues';
import { jobSubjectLabel, outboxEventIdOf, panelJobError } from './jobs.policy';

describe('panelJobError', () => {
  it('первая непустая строка без стека; e-mail замаскированы', () => {
    expect(
      panelJobError('\n  550 Mailbox olga.k@example.by unavailable  \n    at send (smtp.js:1:1)'),
    ).toBe('550 Mailbox [e-mail] unavailable');
    expect(panelJobError('to <a+b@mail.example.com>, cc x@y.by')).toBe(
      'to <[e-mail]>, cc [e-mail]',
    );
  });

  it('пусто — null; длинная — обрезана до предела с многоточием', () => {
    expect(panelJobError(undefined)).toBeNull();
    expect(panelJobError(' \n ')).toBeNull();
    const long = panelJobError('x'.repeat(FAILED_JOB_ERROR_MAX + 50));
    expect(long).toHaveLength(FAILED_JOB_ERROR_MAX);
    expect(long?.endsWith('…')).toBe(true);
    expect(panelJobError('y'.repeat(FAILED_JOB_ERROR_MAX))).toHaveLength(FAILED_JOB_ERROR_MAX);
  });
});

describe('outboxEventIdOf', () => {
  it('только uuid из outboxEventId; прочие данные и мусор — null', () => {
    const id = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect(outboxEventIdOf({ outboxEventId: id, userId: 'u' })).toBe(id);
    for (const data of [null, 'x', { outboxEventId: 'x' }, { userId: id }, { outboxEventId: 1 }]) {
      expect(outboxEventIdOf(data)).toBeNull();
    }
  });
});

describe('очереди экрана', () => {
  it('все очереди queues.ts, по одному разу, имена проходят QueueName', () => {
    expect(QUEUE_NAMES).toEqual(Object.values(QUEUE));
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
    for (const name of QUEUE_NAMES) expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it('подпись журнала — очередь и id задачи', () => {
    expect(jobSubjectLabel('panel-email', 'abc')).toBe('panel-email · abc');
  });
});
