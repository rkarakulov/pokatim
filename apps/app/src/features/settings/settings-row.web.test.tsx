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

  it('строка выбора с превью и описанием (user-theme): радио по названию, описание — подсказкой и текстом', () => {
    render(
      <SettingsRow
        label="Атлас"
        description="Карта и маршрут на первом плане"
        leading={<span data-testid="preview" />}
        selected={false}
        onPress={() => undefined}
      />,
    );
    const radio = screen.getByRole('radio', { name: 'Атлас' });
    expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(radio.textContent).toContain('Карта и маршрут на первом плане');
    expect(screen.getByTestId('preview')).toBeTruthy();
  });
});
