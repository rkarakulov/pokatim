/// <reference types="jest" />
import { render, screen } from '@testing-library/react';

import { SettingsRow } from './settings-row';

describe('SettingsRow (web)', () => {
  it('строка выбора — radio с aria-checked (Playwright toBeChecked)', () => {
    render(
      <>
        <SettingsRow label="Русский" selected onPress={() => undefined} />
        <SettingsRow label="English" selected={false} onPress={() => undefined} />
      </>,
    );
    expect(screen.getByRole('radio', { name: 'Русский' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });
});
