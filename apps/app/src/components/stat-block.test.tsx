/// <reference types="jest" />
import { appThemes, size } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

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
    // обычный размер шрифта (мок Dimensions в jest — fontScale 2)
    const window = Dimensions.get('window');
    Dimensions.set({ window: { ...window, fontScale: 1 }, screen: Dimensions.get('screen') });
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
    Dimensions.set({ window, screen: Dimensions.get('screen') });
  });
});

describe('StatBlock compact: крупный шрифт (ревью pass 1, M1)', () => {
  const window = Dimensions.get('window');
  afterEach(() => {
    Dimensions.set({ window, screen: Dimensions.get('screen') });
  });

  it('fontScale > 1 — значение и подпись переносятся внутри колонки, без многоточия; текст целиком', async () => {
    Dimensions.set({ window: { ...window, fontScale: 1.6 }, screen: Dimensions.get('screen') });
    await render(
      <StatBlock
        variant="compact"
        items={[{ value: '2 ч 30 мин', label: 'В пути', note: 'при 24 км/ч' }]}
      />,
    );
    const value = screen.getByTestId('stat-block-value');
    expect(value).not.toHaveProp('numberOfLines', 1);
    expect(value.props.numberOfLines).toBeUndefined();
    expect(screen.getByText('В пути').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('2 ч 30 мин')).toBeOnTheScreen();
  });
});

describe('StatBlock: варианты шапки шторки (app-themes C2)', () => {
  const items = [
    { value: '68', unit: 'км', label: 'Дистанция', note: 'круговой' },
    { value: '1 240', unit: 'м', label: 'Набор', note: 'макс. 267 м' },
    { value: '2 ч 30 мин', label: 'В пути', note: 'при 24 км/ч' },
  ];
  const window = Dimensions.get('window');
  const fontScale = (value: number) =>
    Dimensions.set({ window: { ...window, fontScale: value }, screen: Dimensions.get('screen') });
  afterEach(() => {
    Dimensions.set({ window, screen: Dimensions.get('screen') });
  });

  it('tiles: три равные плитки surface.default (шторка — surface.sheet = raised) с радиусом shape.card; значение с единицей и подпись; note — только в метке', async () => {
    fontScale(1);
    await render(<StatBlock variant="tiles" items={items} />, {
      wrapper: appThemeWrapper('chrono'),
    });
    const { surface, shape } = appThemes.chrono.schemes.dark;
    const tiles = screen.getAllByTestId('stat-block-cell');
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile).toHaveStyle({
        backgroundColor: surface.default,
        borderRadius: shape.card,
        flexBasis: 0,
        flexGrow: 1,
      });
    }
    expect(screen.getByLabelText('Дистанция 68 км круговой')).toBeOnTheScreen();
    expect(screen.getByText('км')).toBeOnTheScreen();
    expect(screen.queryByText('круговой')).toBeNull();
  });

  it('numeral: дистанция — крупная цифра, остальные — строкой compact; метки ячеек', async () => {
    fontScale(1);
    await render(<StatBlock variant="numeral" items={items} />);
    const numeral = screen.getByTestId('stat-block-numeral');
    expect(numeral).toHaveTextContent('68км');
    expect(screen.getByLabelText('Дистанция 68 км круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Набор 1 240 м/)).toBeOnTheScreen();
    expect(screen.getByLabelText('В пути 2 ч 30 мин при 24 км/ч')).toBeOnTheScreen();
    // остальные ячейки — compact: подпись над значением
    expect(screen.getByText('Набор')).toBeOnTheScreen();
    expect(screen.queryByText('круговой')).toBeNull();
  });
});

describe('StatBlock tiles: узкий экран (app-themes C, ревью pass 1)', () => {
  const items = [
    { value: '123,4', unit: 'км', label: 'Дистанция', note: 'круговой' },
    { value: '1 240', unit: 'м', label: 'Набор' },
    {
      value: '3 ч 35 мин',
      parts: [
        { value: '3', unit: 'ч' },
        { value: '35', unit: 'мин' },
      ],
      label: 'В пути',
      note: 'при 24 км/ч',
    },
  ];
  const window = Dimensions.get('window');
  afterEach(() => {
    Dimensions.set({ window, screen: Dimensions.get('screen') });
  });

  it.each(['chrono', 'navigation'] as const)(
    '%s, 360 px, обычный шрифт: длительность — частями с единицами, ничего не усекается многоточием',
    async (themeId) => {
      Dimensions.set({ window: { ...window, fontScale: 1 }, screen: Dimensions.get('screen') });
      await render(
        <View style={{ width: 320 }}>
          <StatBlock variant="tiles" items={items} />
        </View>,
        { wrapper: appThemeWrapper(themeId) },
      );
      const block = screen.getByTestId('stat-block');
      // части переносятся строками внутри плитки
      for (const value of screen.getAllByTestId('stat-block-value')) {
        expect(value).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
      }
      expect(screen.getByText('3')).toBeOnTheScreen();
      expect(screen.getByText('35')).toBeOnTheScreen();
      expect(screen.getByText('мин')).toBeOnTheScreen();
      // ни один текст плитки не ограничен строками: многоточия нет
      for (const text of ['123,4', '1 240', '3', '35', 'мин', 'Дистанция', 'В пути']) {
        expect(screen.getByText(text).props.numberOfLines).toBeUndefined();
      }
      expect(block).toBeOnTheScreen();
      expect(screen.getByLabelText('В пути 3 ч 35 мин при 24 км/ч')).toBeOnTheScreen();
    },
  );
});
