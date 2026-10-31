/// <reference types="jest" />
import { photoScrim, photoScrimAlpha, themes } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PHOTO_SCRIM_BANDS, PhotoScrim } from './photo-scrim';

describe('PhotoScrim (затемнение фото под текстом, ride-photo)', () => {
  it('полосы цвета overlay.scrim с прозрачностью токена по высоте; скрыт от скринридера и касаний', async () => {
    await render(<PhotoScrim />);
    const scrim = screen.getByTestId('photo-scrim', { includeHiddenElements: true });
    expect(scrim.props.pointerEvents).toBe('none');
    expect(scrim.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(scrim.props['aria-hidden']).toBe(true);

    const bands = screen.getAllByTestId('photo-scrim-band', { includeHiddenElements: true });
    expect(bands).toHaveLength(PHOTO_SCRIM_BANDS);
    const style = (index: number) => StyleSheet.flatten(bands[index]!.props.style);
    expect(style(0).backgroundColor).toBe(themes.light.overlay.scrim);
    expect(style(0).opacity).toBeCloseTo(photoScrimAlpha(0.5 / PHOTO_SCRIM_BANDS), 5);
  });

  it('полосы в зонах текста не светлее границ зоны по токену (контраст onPhoto, допуск шага)', async () => {
    await render(<PhotoScrim />);
    const bands = screen.getAllByTestId('photo-scrim-band', { includeHiddenElements: true });
    const minTextAlpha = Math.min(
      ...photoScrim.textZones.flatMap((zone) => [
        photoScrimAlpha(zone.from),
        photoScrimAlpha(zone.to),
      ]),
    );
    bands.forEach((band, index) => {
      const center = (index + 0.5) / PHOTO_SCRIM_BANDS;
      const inText = photoScrim.textZones.some((zone) => center >= zone.from && center <= zone.to);
      if (inText) {
        expect(StyleSheet.flatten(band.props.style).opacity).toBeGreaterThanOrEqual(
          minTextAlpha - 0.02,
        );
      }
    });
  });
});
