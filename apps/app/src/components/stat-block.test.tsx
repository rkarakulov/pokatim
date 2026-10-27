/// <reference types="jest" />
import { size } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { StatBlock } from './stat-block';

describe('StatBlock', () => {
  it('значение, единица и подпись; одна метка на ячейку', async () => {
    await render(
      <StatBlock
        items={[
          { value: '100', unit: 'км', label: 'Дистанция' },
          { value: '60', unit: 'км', label: 'Дистанция' },
        ]}
      />,
    );

    expect(screen.getByText('100')).toBeOnTheScreen();
    expect(screen.getByText('60')).toBeOnTheScreen();
    expect(screen.getAllByText('км')).toHaveLength(2);
    expect(screen.getAllByText('Дистанция')).toHaveLength(2);
    expect(screen.getByLabelText('Дистанция 100 км')).toBeOnTheScreen();
    expect(screen.getByLabelText('Дистанция 60 км')).toBeOnTheScreen();
  });

  it('пять дистанций в узкой колонке и крупный шрифт: ячейки по содержимому, переносятся рядами, «км» — под значением (ревью pass 1)', async () => {
    await render(
      <View style={{ width: 200 }}>
        <StatBlock
          items={[100, 80, 60, 42, 21].map((km) => ({
            value: String(km),
            unit: 'км',
            label: 'Дистанция',
          }))}
        />
      </View>,
    );
    const cells = screen.getAllByTestId('stat-block-cell');
    expect(cells).toHaveLength(5);
    for (const cell of cells) {
      // ширина — по содержимому, не меньше токена и без сжатия в ноль: не влезло — новый ряд
      expect(cell).toHaveStyle({ flexBasis: 'auto', flexShrink: 0, minWidth: size.rowMin });
    }
    for (const row of screen.getAllByTestId('stat-block-value')) {
      expect(row).toHaveStyle({ flexWrap: 'wrap' });
    }
  });

  it('без единицы — только значение; ряды переносятся (flexWrap)', async () => {
    await render(<StatBlock items={[{ value: '3', label: 'Этапа' }]} />);
    expect(screen.getByLabelText('Этапа 3')).toBeOnTheScreen();
    expect(screen.getByTestId('stat-block')).toHaveStyle({ flexWrap: 'wrap' });
  });
});

describe('StatBlock: пояснение (routes-03)', () => {
  it('note — строкой под подписью и в метке ячейки; без note — как прежде', async () => {
    await render(
      <StatBlock
        items={[
          { value: '68', unit: 'км', label: 'Дистанция', note: 'круговой' },
          { value: '3', label: 'Этапа' },
        ]}
      />,
    );
    expect(screen.getByText('круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText('Дистанция 68 км круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText('Этапа 3')).toBeOnTheScreen();
  });

  it('equalColumns (routes-04, RC-11): три колонки равной ширины в ряд на 375 — ячейки сжимаются, текст переносится внутри', async () => {
    await render(
      <StatBlock
        equalColumns
        items={[
          { value: '68', unit: 'км', label: 'Дистанция', note: 'круговой' },
          { value: '1 240', unit: 'м', label: 'Набор', note: 'макс. 267 м' },
          { value: '3 ч 35 мин', label: 'В пути', note: 'при 24 км/ч' },
        ]}
      />,
    );
    const cells = screen.getAllByTestId('stat-block-cell');
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell).toHaveStyle({ flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: size.rowMin });
    }
  });
});

describe('StatBlock variant="compact" (routes-04d, RC-9)', () => {
  const items = [
    { value: '68', unit: 'км', label: 'Дистанция', note: 'круговой' },
    { value: '1 240', unit: 'м', label: 'Набор', note: 'макс. 267 м' },
    { value: '2 ч 30 мин', label: 'В пути', note: 'при 24 км/ч' },
  ];

  it('один ряд равных колонок без ink-линии; значение — одна строка; note — только в метке ячейки', async () => {
    await render(<StatBlock variant="compact" items={items} />);
    const block = screen.getByTestId('stat-block');
    expect(block).toHaveStyle({ flexDirection: 'row' });
    expect(block).not.toHaveStyle({ flexWrap: 'wrap' });
    expect(block).not.toHaveStyle({ borderTopWidth: expect.anything() });
    for (const cell of screen.getAllByTestId('stat-block-cell')) {
      expect(cell).toHaveStyle({ flexBasis: 0, flexGrow: 1, flexShrink: 1 });
    }
    for (const value of screen.getAllByTestId('stat-block-value')) {
      expect(value).toHaveProp('numberOfLines', 1);
    }
    expect(screen.queryByText('круговой')).toBeNull();
    expect(screen.getByLabelText('Дистанция 68 км круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText('В пути 2 ч 30 мин при 24 км/ч')).toBeOnTheScreen();
    expect(screen.getByText('Дистанция')).toBeOnTheScreen();
  });
});
