/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('progressbar с подписью и значением; заполнение — доля, вне диапазона — в границах', async () => {
    await render(<ProgressBar value={7} max={14} accessibilityLabel="Цель" testID="bar" />);
    const bar = screen.getByRole('progressbar', { name: 'Цель' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 14, now: 7 });
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ width: '50%' });
    await render(<ProgressBar value={20} max={10} accessibilityLabel="Цель" testID="over" />);
    expect(screen.getByTestId('over-fill')).toHaveStyle({ width: '100%' });
  });
});
