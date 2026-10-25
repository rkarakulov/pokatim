/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FilterGroup, FilterGroupSkeleton } from './filter-group';

const options = [
  { value: 'road', label: 'Шоссе' },
  { value: 'gravel', label: 'Гравий' },
] as const;

describe('FilterGroup', () => {
  it('подпись группы и чипы; выбранное состояние; нажатие — значение чипа', async () => {
    const onToggle = jest.fn();
    await render(
      <FilterGroup label="Класс" options={options} selected={['gravel']} onToggle={onToggle} />,
    );

    expect(screen.getByText('Класс')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Гравий' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Шоссе' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Шоссе' }));
    expect(onToggle).toHaveBeenCalledWith('road');
  });

  it('ряд чипов — горизонтальная прокрутка', async () => {
    await render(
      <FilterGroup
        label="Дата"
        options={options}
        selected={[]}
        onToggle={jest.fn()}
        testID="filter-date"
      />,
    );
    expect(screen.getByTestId('filter-date')).toHaveProp('horizontal', true);
  });
});

describe('FilterGroupSkeleton', () => {
  it('подпись сразу, на месте чипов — «Загрузка», чипов нет', async () => {
    await render(<FilterGroupSkeleton label="Город" />);
    expect(screen.getByText('Город')).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
