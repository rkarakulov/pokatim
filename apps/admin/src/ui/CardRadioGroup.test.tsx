// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardRadioGroup } from './CardRadioGroup';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Первая', children: <p>Описание первой</p> },
  { value: 'b', label: 'Вторая', children: <p>Описание второй</p> },
  { value: 'c', label: 'Третья', children: <p>Описание третьей</p> },
] as const;

function Controlled({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return (
    <CardRadioGroup
      legend="Тема"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('CardRadioGroup', () => {
  it('fieldset с legend, нативные радио с подписью карточки, произвольное содержимое', () => {
    render(<Controlled onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Тема' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['a', 'b', 'c']);
    expect((screen.getByRole('radio', { name: /Первая/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Описание второй')).toBeTruthy();
    expect(new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size).toBe(1);
  });

  it('выбор карточки — onChange со значением, отметка и класс выбранной', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const second = screen.getByRole('radio', { name: /Вторая/ }) as HTMLInputElement;
    fireEvent.click(second);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(second.checked).toBe(true);
    expect(second.closest('label')?.className).toContain('card-radio--checked');
    expect(
      (screen.getByRole('radio', { name: /Первая/ }) as HTMLInputElement).closest('label')
        ?.className,
    ).not.toContain('card-radio--checked');
  });

  it('фокус — на нативном радио (клавиатура браузера)', () => {
    render(<Controlled onChange={vi.fn()} />);
    const first = screen.getByRole('radio', { name: /Первая/ });
    first.focus();
    expect(document.activeElement).toBe(first);
  });
});
