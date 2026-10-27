/// <reference types="jest" />
import type { CatalogRouteElevation } from '@pokatim/contracts';

import { scrubReadout, scrubStep } from './scrub';

// 0 → 1 км подъём 5 %, 1 → 2 км спуск 3 %; профиль короче маршрута не бывает — длина профиля = distanceM
const elevation: CatalogRouteElevation = {
  minM: 200,
  maxM: 250,
  profile: Array.from({ length: 9 }, (_, i) => {
    const d = i * 250;
    return [d, d <= 1000 ? 200 + d * 0.05 : 250 - (d - 1000) * 0.03];
  }),
};

describe('scrubReadout (routes-04, S3, RC-10)', () => {
  it('подъём: «0,5 км · 225 м · ↗ 5 % · набор 25 м» и значение словами без стрелок', () => {
    const readout = scrubReadout(elevation, 2000, null, 0.25);
    expect(readout).toEqual({
      distance: '0,5 км',
      elevation: '225 м',
      grade: '↗ 5 %',
      gain: 'набор 25 м',
      valueText: '0,5 км, высота 225 м, уклон 5 %',
    });
  });

  it('спуск — «↘ 3 %», в значении знак минус U+2212; набор масштабирован к набору сервера', () => {
    const readout = scrubReadout(elevation, 2000, 60, 0.75);
    expect(readout.grade).toBe('↘ 3 %');
    expect(readout.valueText).toBe('1,5 км, высота 235 м, уклон −3 %');
    expect(readout.gain).toBe('набор 60 м');
  });

  it('ровно — «→ 0 %»; 0 км — старт; дистанция маршрута ≠ длине профиля — доля, а не метры', () => {
    const flat: CatalogRouteElevation = {
      minM: 100,
      maxM: 100,
      profile: [
        [0, 100],
        [1000, 100],
      ],
    };
    const start = scrubReadout(flat, 1000, null, 0);
    expect(start.grade).toBe('→ 0 %');
    expect(start.valueText).toBe('0 км, высота 100 м, уклон 0 %');
    // маршрут 2 км, профиль 2 км: середина — 1 км и вершина подъёма; маршрут объявлен 4 км — та же доля, «2 км»
    expect(scrubReadout(elevation, 4000, null, 0.5)).toMatchObject({
      distance: '2 км',
      elevation: '250 м',
    });
  });

  it('высота и набор округлены до целых, км — до десятых, разделитель — запятая', () => {
    const readout = scrubReadout(elevation, 12_437, null, 0.0001);
    expect(readout.distance).toBe('0 км');
    expect(scrubReadout(elevation, 12_437, null, 1).distance).toBe('12,4 км');
  });
});

describe('scrubStep (adjustable / стрелки: 1 км)', () => {
  it('доля → следующий/предыдущий целый км → доля; границы 0 и 1', () => {
    expect(scrubStep(0, 3500, 1)).toBeCloseTo(1000 / 3500, 9);
    expect(scrubStep(3000 / 3500, 3500, 1)).toBe(1);
    expect(scrubStep(1, 3500, -1)).toBeCloseTo(3000 / 3500, 9);
    expect(scrubStep(0, 3500, -1)).toBe(0);
    expect(scrubStep(0.5, 0, 1)).toBe(0);
  });
});
