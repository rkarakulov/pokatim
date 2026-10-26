// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StatTile } from './StatTile';

afterEach(cleanup);

describe('StatTile (RC-9)', () => {
  it('плитка — группа с подписью; значение и подсказка внутри', () => {
    render(<StatTile label="Участники" value={42} hint="активные заявки" />);
    const tile = screen.getByRole('group', { name: 'Участники' });
    expect(within(tile).getByText('42')).toBeTruthy();
    expect(within(tile).getByText('активные заявки')).toBeTruthy();
  });

  it('значения ещё нет — скелетон на месте числа, подпись видна', () => {
    render(<StatTile label="Отказы" value={undefined} />);
    const tile = screen.getByRole('group', { name: 'Отказы' });
    expect(tile.getAttribute('aria-busy')).toBe('true');
    expect(within(tile).getByTestId('skeleton-stat')).toBeTruthy();
  });
});
