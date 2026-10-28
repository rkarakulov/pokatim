/// <reference types="jest" />
import { appThemes, size, themes } from '@pokatim/design-tokens';
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

describe('MapControls: «Моё местоположение» (routes-04d, RC-6, RC-13)', () => {
  const noop = () => undefined;

  it('без onLocate — три кнопки; с onLocate — четвёртая с подписью, цель не меньше touchMin', async () => {
    await render(
      <MapControls theme={themes.light} onZoomIn={noop} onZoomOut={noop} onFit={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Моё местоположение' })).toBeNull();
    const onLocate = jest.fn();
    await render(
      <MapControls
        theme={themes.light}
        onZoomIn={noop}
        onZoomOut={noop}
        onFit={noop}
        onLocate={onLocate}
      />,
    );
    const locate = screen.getByRole('button', { name: 'Моё местоположение' });
    expect(StyleSheet.flatten(locate.props.style).width).toBeGreaterThanOrEqual(size.touchMin);
    await fireEvent.press(locate);
    expect(onLocate).toHaveBeenCalledTimes(1);
  });

  it('идёт чтение — кнопка недоступна и занята, нажатие не доходит', async () => {
    const onLocate = jest.fn();
    await render(
      <MapControls
        theme={themes.light}
        onZoomIn={noop}
        onZoomOut={noop}
        onFit={noop}
        onLocate={onLocate}
        locating
      />,
    );
    const locate = screen.getByRole('button', { name: 'Моё местоположение' });
    expect(locate).toBeBusy();
    expect(locate).toBeDisabled();
    await fireEvent.press(locate);
    expect(onLocate).not.toHaveBeenCalled();
  });
});

describe('MapControls: форма темы (app-themes C1)', () => {
  const noop = () => undefined;
  const radiusOf = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID).props.style).borderRadius;

  it.each(Object.values(appThemes))(
    '$id: радиус кнопок — shape.button темы, прямые углы, как у «Классики»',
    async (def) => {
      await render(
        <MapControls theme={def.schemes.dark} onZoomIn={noop} onZoomOut={noop} onFit={noop} />,
      );
      expect(radiusOf('map-fit')).toBe(def.schemes.dark.shape.button);
      expect(radiusOf('map-fit')).toBe(0);
    },
  );
});
