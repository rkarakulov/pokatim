/// <reference types="jest" />
import { stroke, themes } from '@pokatim/design-tokens';

import {
  splitTrackLine,
  TRACK_OUTSIDE_OPACITY,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
  type RouteMapTrack,
} from './track-style';

const line: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [20, 10],
];

describe('track-style (maps-02)', () => {
  it('разрез по дробным позициям: до старта и после финиша — «вне сегмента», сегмент, сход', () => {
    const parts = splitTrackLine(line, { from: 0.5, to: 2.5 }, [{ from: 1, to: 1.5 }]);
    expect(parts.outside).toEqual([
      [
        [0, 0],
        [5, 0],
      ],
      [
        [15, 10],
        [20, 10],
      ],
    ]);
    expect(parts.segment).toEqual([
      [
        [5, 0],
        [10, 0],
        [10, 10],
        [15, 10],
      ],
    ]);
    expect(parts.off).toEqual([
      [
        [10, 0],
        [10, 5],
      ],
    ]);
  });

  it('без разметки (segment null) — весь трек сегментом, без схода', () => {
    expect(splitTrackLine(line, null, [{ from: 1, to: 2 }])).toEqual({
      outside: [],
      segment: [line],
      off: [],
    });
  });

  it('позиции зажимаются в [0, n − 1]; пустые и from > to отбрасываются; сегмент на всю линию — без «вне»', () => {
    const parts = splitTrackLine(line, { from: -1, to: 9 }, [
      { from: 2, to: 2 },
      { from: 2.5, to: 2 },
      { from: 2.5, to: 7 },
    ]);
    expect(parts.outside).toEqual([]);
    expect(parts.segment).toEqual([line]);
    expect(parts.off).toEqual([
      [
        [15, 10],
        [20, 10],
      ],
    ]);
  });

  it('GeoJSON: линии с kind; слои — вне сегмента тоньше и прозрачнее, сход — пунктир, толще, своя роль', () => {
    const track: RouteMapTrack = { line, segment: { from: 0.5, to: 2.5 }, offRuns: [] };
    const features = trackFeatures(track);
    expect(features.features.map((f) => f.properties.kind)).toEqual([
      'outside',
      'outside',
      'segment',
    ]);
    const layers = trackLayers(themes.dark);
    expect(layers.map((layer) => [layer.id, layer.source])).toEqual([
      ['track-outside', TRACK_SOURCE_ID],
      ['track', TRACK_SOURCE_ID],
      ['track-off', TRACK_SOURCE_ID],
    ]);
    const [outside, segment, off] = layers;
    expect(segment!.paint).toMatchObject({ 'line-color': themes.dark.map.track });
    expect(outside!.paint).toMatchObject({
      'line-color': themes.dark.map.track,
      'line-opacity': TRACK_OUTSIDE_OPACITY,
    });
    expect(Number(outside!.paint!['line-width'])).toBeLessThan(
      Number(segment!.paint!['line-width']),
    );
    expect(off!.paint).toMatchObject({ 'line-color': themes.dark.map.offCorridor });
    expect(off!.paint!['line-dasharray']).toBeDefined();
    expect(Number(off!.paint!['line-width'])).toBeGreaterThan(
      Number(segment!.paint!['line-width']),
    );
    expect(Number(segment!.paint!['line-width'])).toBeGreaterThan(stroke.indicator);
  });

  it('рамка: объединение рамки маршрута и трека; без трека — рамка маршрута', () => {
    expect(unionBounds([0, 0, 10, 10], line)).toEqual([0, 0, 20, 10]);
    expect(unionBounds([5, -5, 8, 3], line)).toEqual([0, -5, 20, 10]);
    expect(unionBounds([0, 0, 10, 10], undefined)).toEqual([0, 0, 10, 10]);
  });
});
