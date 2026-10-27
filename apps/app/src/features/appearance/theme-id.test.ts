/// <reference types="jest" />
import { APP_THEME_IDS } from '@pokatim/contracts';

import { toAppThemeId } from './theme-id';

describe('toAppThemeId', () => {
  it.each(APP_THEME_IDS)('%s — как есть', (id) => expect(toAppThemeId(id)).toBe(id));

  it.each([['unknown'], ['CLASSIC'], [''], [42], [null], [undefined], [{ id: 'atlas' }]])(
    '%p — «Классика»',
    (value) => expect(toAppThemeId(value)).toBe('classic'),
  );
});
