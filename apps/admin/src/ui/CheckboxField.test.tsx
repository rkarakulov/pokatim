// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckboxField } from './fields';

afterEach(cleanup);

describe('CheckboxField (event-tickets PR C)', () => {
  it('нативный чекбокс с подписью, подсказкой и ошибкой (aria-describedby, aria-invalid)', () => {
    const onChange = vi.fn();
    render(
      <CheckboxField
        label="Выдавать билеты"
        help="Участники получат билет с QR"
        error="Проверьте значение"
        onChange={onChange}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Выдавать билеты' });
    expect(box.getAttribute('aria-invalid')).toBe('true');
    const described = box.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Проверьте значение',
      'Участники получат билет с QR',
    ]);
    fireEvent.click(screen.getByText('Выдавать билеты'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});
