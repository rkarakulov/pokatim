/// <reference types="jest" />
import { appThemes, appThemeScheme } from '@pokatim/design-tokens';

import {
  BAT,
  COBWEB,
  cobwebPath,
  halloweenColors,
  MOON,
  PUMPKIN,
  SPIDER,
  WITCH,
} from './halloween-art';

describe('графика хеллоуинского декора (halloween-decor)', () => {
  it('паутина детерминирована: лучи из правого верхнего угла и кольца-кривые', () => {
    const d = cobwebPath();
    expect(cobwebPath()).toBe(d);
    expect(d.match(/M120 0L/g)).toHaveLength(6);
    expect(d.match(/Q/g)).toHaveLength(5 * 5);
    expect(d).not.toMatch(/NaN|undefined/);
  });

  it('у каждой фигуры — путь и роль цвета, без значений цвета', () => {
    for (const art of [COBWEB, SPIDER, WITCH, BAT, MOON, PUMPKIN]) {
      expect(art.viewBox.split(' ')).toHaveLength(4);
      for (const shape of art.shapes) {
        expect(shape.d).not.toMatch(/NaN|undefined/);
        expect(shape.fill ?? shape.stroke).toBeDefined();
        expect(JSON.stringify(shape)).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });

  it('цвета — роли активной темы («Классика»: тыква — акцент, силуэты — основной текст)', () => {
    const def = appThemes.classic;
    const theme = def.schemes[appThemeScheme(def, 'light')];
    expect(halloweenColors(theme)).toEqual({
      ink: theme.text.primary,
      pumpkin: theme.text.accent,
      stem: theme.status.success,
      face: theme.surface.default,
      moon: theme.status.warning,
    });
  });
});
