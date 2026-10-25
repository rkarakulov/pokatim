// @vitest-environment jsdom
import { minskWallTimeToUtc } from '@pokatim/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { ChipGroup } from './ChipGroup';
import { ChoiceDialog } from './ChoiceDialog';
import { DateTimeField } from './DateTimeField';
import { DisabledReason, ReadonlyField } from './layout-parts';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  cleanup();
  process.env.TZ = ORIGINAL_TZ;
});

describe('DateTimeField (AC13)', () => {
  function Form({ onSubmit }: { onSubmit: (utc: string) => void }) {
    const [value, setValue] = useState('');
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(minskWallTimeToUtc(value));
        }}
      >
        <DateTimeField
          label="Окно: конец"
          zoneLabel="Europe/Minsk"
          value={value}
          onChange={setValue}
        />
        <button type="submit">Сохранить</button>
      </form>
    );
  }

  it.each(['Europe/Minsk', 'America/New_York', 'Asia/Tokyo'])(
    'ввод «25.10.2026 23:59» уходит как 2026-10-25T20:59:00Z при поясе браузера %s',
    (tz) => {
      process.env.TZ = tz;
      const onSubmit = vi.fn();
      render(<Form onSubmit={onSubmit} />);
      const input = screen.getByLabelText(/Окно: конец/);
      expect(input.getAttribute('type')).toBe('datetime-local');
      fireEvent.change(input, { target: { value: '2026-10-25T23:59' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      expect(onSubmit).toHaveBeenCalledWith('2026-10-25T20:59:00Z');
    },
  );

  it('метка пояса у подписи; зафиксированное поле — неактивно, значение видно, замок', () => {
    render(
      <DateTimeField
        label="Окно: начало"
        zoneLabel="Europe/Minsk"
        lockedLabel="зафиксировано"
        value="2026-10-24T00:00"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText(/Окно: начало/) as HTMLInputElement;
    expect(screen.getByText('Europe/Minsk')).toBeTruthy();
    expect(screen.getByText('зафиксировано')).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('2026-10-24T00:00');
  });
});

describe('ChipGroup', () => {
  function Chips({ onChange }: { onChange?: (value: string[]) => void }) {
    const [value, setValue] = useState<('asphalt' | 'gravel')[]>(['gravel']);
    return (
      <ChipGroup
        label="Покрытие · можно несколько"
        options={[
          { value: 'asphalt', label: 'Асфальт' },
          { value: 'gravel', label: 'Гравий' },
        ]}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        error="Заполните поле."
      />
    );
  }

  it('группа с подписью; aria-pressed; порядок значения — порядок вариантов; ошибка под группой', () => {
    const onChange = vi.fn();
    render(<Chips onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Покрытие · можно несколько' });
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    const asphalt = screen.getByRole('button', { name: 'Асфальт' });
    const gravel = screen.getByRole('button', { name: 'Гравий' });
    expect(asphalt.getAttribute('aria-pressed')).toBe('false');
    expect(gravel.getAttribute('aria-pressed')).toBe('true');

    asphalt.focus();
    expect(document.activeElement).toBe(asphalt);
    fireEvent.click(asphalt);
    expect(onChange).toHaveBeenLastCalledWith(['asphalt', 'gravel']);
    fireEvent.click(gravel);
    expect(onChange).toHaveBeenLastCalledWith(['asphalt']);
    expect(screen.getByRole('alert').textContent).toBe('Заполните поле.');
  });
});

describe('ChoiceDialog', () => {
  type Reason = 'weather' | 'platform_issue';
  function Harness({ onConfirm }: { onConfirm: (value: Reason) => Promise<void> }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Отменить гонку
        </button>
        <ChoiceDialog<Reason>
          open={open}
          title="Отменить гонку?"
          consequences="Отменить это действие нельзя."
          choicesLabel="Причина для участников (обязательно)"
          choices={[
            { value: 'weather', label: 'Неблагоприятные погодные условия' },
            { value: 'platform_issue', label: 'Техническая проблема на платформе' },
          ]}
          preview={(value) => (value ? `Участники увидят «${value}»` : 'Выберите причину')}
          confirmLabel="Подтвердить отмену"
          destructive
          errorText={() => 'Не удалось'}
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  function open(onConfirm = vi.fn().mockResolvedValue(undefined)) {
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Отменить гонку' });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, onConfirm };
  }

  it('фокус — на первом варианте; подтверждение неактивно без выбора; превью выбранного', () => {
    open();
    const first = screen.getByRole('radio', { name: 'Неблагоприятные погодные условия' });
    expect(document.activeElement).toBe(first);
    const confirm = screen.getByRole('button', { name: 'Подтвердить отмену' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(screen.getByText('Выберите причину')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Техническая проблема на платформе' }));
    expect(confirm).toHaveProperty('disabled', false);
    expect(screen.getByText('Участники увидят «platform_issue»')).toBeTruthy();
    expect(confirm.className).toContain('button--danger-solid');
  });

  it('подтверждение отдаёт выбранное значение и закрывает; фокус возвращается на триггер', async () => {
    const { trigger, onConfirm } = open();
    fireEvent.click(screen.getByRole('radio', { name: 'Неблагоприятные погодные условия' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledWith('weather');
    expect(document.activeElement).toBe(trigger);
  });

  it('Esc закрывает без подтверждения; ошибка запроса — в окне', async () => {
    const { onConfirm, trigger } = open(vi.fn().mockRejectedValue(new Error('x')));
    fireEvent.click(screen.getByRole('radio', { name: 'Неблагоприятные погодные условия' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    expect(await screen.findByText('Не удалось')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('DisabledReason и ReadonlyField', () => {
  it('кнопка aria-disabled остаётся в фокусе и описана причиной', () => {
    render(
      <>
        <Button aria-disabled="true" aria-describedby="why">
          Создать сезон
        </Button>
        <DisabledReason id="why">Недоступно: исправьте даты</DisabledReason>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Создать сезон' });
    expect(button).toHaveProperty('disabled', false);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Недоступно: исправьте даты',
    );
  });

  it('вычисляемое значение — не поле ввода, с подписью и подсказкой', () => {
    render(
      <ReadonlyField
        label="Сезон (по концу окна)"
        value="Сезон 2026"
        help="Определяется автоматически"
      />,
    );
    const output = screen.getByRole('status', { name: 'Сезон (по концу окна)' });
    expect(output.textContent).toBe('Сезон 2026');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
