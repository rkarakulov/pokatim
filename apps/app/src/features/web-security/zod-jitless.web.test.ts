/// <reference types="jest" />
import { z } from 'zod';

import './zod-jitless';

describe('zod в web без new Function (строгий CSP, ADR-0025)', () => {
  it('jitless включён импортом модуля', () => {
    expect(z.config().jitless).toBe(true);
  });
});
