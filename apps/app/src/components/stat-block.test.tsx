/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';

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

  it('без единицы — только значение; ряды переносятся (flexWrap)', async () => {
    await render(<StatBlock items={[{ value: '3', label: 'Этапа' }]} />);
    expect(screen.getByLabelText('Этапа 3')).toBeOnTheScreen();
    expect(screen.getByTestId('stat-block')).toHaveStyle({ flexWrap: 'wrap' });
  });
});
