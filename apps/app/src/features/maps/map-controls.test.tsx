/// <reference types="jest" />
import { size, themes } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MapControls } from './map-controls';

describe('MapControls (routes-04b, RC-5)', () => {
  it('три кнопки с ролью и подписью, цель не меньше touchMin; нажатие — свой обработчик', async () => {
    const onZoomIn = jest.fn();
    const onZoomOut = jest.fn();
    const onFit = jest.fn();
    await render(
      <MapControls theme={themes.light} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />,
    );
    const zoomIn = screen.getByRole('button', { name: 'Приблизить' });
    const zoomOut = screen.getByRole('button', { name: 'Отдалить' });
    const fit = screen.getByRole('button', { name: 'Показать маршрут целиком' });
    expect(screen.getByTestId('map-zoom-in')).toBe(zoomIn);
    expect(screen.getByTestId('map-zoom-out')).toBe(zoomOut);
    expect(screen.getByTestId('map-fit')).toBe(fit);
    for (const button of [zoomIn, zoomOut, fit]) {
      const style = StyleSheet.flatten(button.props.style);
      expect(style.width).toBeGreaterThanOrEqual(size.touchMin);
      expect(style.height).toBeGreaterThanOrEqual(size.touchMin);
    }
    await fireEvent.press(zoomIn);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    await fireEvent.press(zoomOut);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    await fireEvent.press(fit);
    expect(onFit).toHaveBeenCalledTimes(1);
  });
});
