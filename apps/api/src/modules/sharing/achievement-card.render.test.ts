import { ACHIEVEMENT_CODES, isSeasonalCode } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENT_BADGE_ICONS, badgeCount } from './achievement-card.icons';
import { type AchievementCardInput, achievementCardHash } from './achievement-card.inputs';
import { achievementCardRenderInput, renderAchievementCardSvg } from './achievement-card.png';
import { achievementCardTree } from './achievement-card.render';
import { achievementCardTexts } from './achievement-card.texts';
import { storyCardFonts, symbolsFont } from './story-card.fonts';
import { renderCardSvg } from './story-card.png';
import { STORY_CARD_POLICY } from './sharing.policy';
import { node, type StoryCardNode } from './story-card.render';

/** Входы по умолчанию (синтетика): «Победа» в гонке 4 октября 2026. */
function input(
  overrides: Partial<AchievementCardInput> = {},
  facts: Partial<AchievementCardInput['facts']> = {},
): AchievementCardInput {
  return {
    template: 'line',
    themeId: 'classic',
    objectTitle: 'Минская сотка',
    riderName: null,
    ...overrides,
    facts: {
      code: 'race_win',
      object: { kind: 'race', id: 'race', title: 'Минская сотка' },
      factDate: '2026-10-04',
      level: null,
      ...facts,
    },
  };
}

/** Все строки дерева satori (порядок обхода). */
function strings(node: StoryCardNode | string | null | undefined, into: string[] = []): string[] {
  if (node === null || node === undefined) return into;
  if (typeof node === 'string') {
    into.push(node);
    return into;
  }
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) strings(child, into);
  return into;
}

const tree = (value: AchievementCardInput) =>
  achievementCardTree(achievementCardRenderInput(value));

describe('тексты карточки достижения', () => {
  it('метка, название и условие каталога, объект, дата с годом, бренд', () => {
    expect(achievementCardTexts(input())).toEqual({
      kicker: 'Достижение',
      title: 'Победа',
      condition: 'Первое место в своей группе',
      object: 'Гонка «Минская сотка»',
      riderName: null,
      date: '4 октября 2026',
      brand: expect.any(String),
    });
  });

  it('маршрут и райд — своя подпись; объект не публичный — строки нет; имя — как пришло', () => {
    const route = input(
      { objectTitle: 'Вокруг Минска' },
      {
        code: 'route_first',
        object: { kind: 'route', id: 'r', title: 'Вокруг Минска' },
      },
    );
    expect(achievementCardTexts(route).object).toBe('Маршрут «Вокруг Минска»');
    const ride = input(
      { objectTitle: 'Утренний' },
      {
        code: 'ride_first',
        object: { kind: 'ride', id: 'r', title: 'Утренний' },
      },
    );
    expect(achievementCardTexts(ride).object).toBe('Кофе-райд «Утренний»');
    const hidden = input(
      { objectTitle: null, riderName: 'Анна К.' },
      {
        code: 'route_first',
        object: { kind: 'route', id: 'r', title: 'Мой секретный' },
      },
    );
    expect(achievementCardTexts(hidden).object).toBeNull();
    expect(achievementCardTexts(hidden).riderName).toBe('Анна К.');
  });

  it('счётное: название, условие уровня (порог), метка уровня в kicker (RC-L7)', () => {
    const silver = achievementCardTexts(input({}, { code: 'races_5', level: 'silver' }));
    expect(silver).toMatchObject({
      kicker: 'Достижение · Серебро',
      title: 'Гонщик',
      condition: 'Финиш в зачёте 15 разных гонок',
    });
    const gold = achievementCardTexts(input({}, { code: 'rides_10', level: 'gold' }));
    expect(gold).toMatchObject({
      kicker: 'Достижение · Золото',
      title: 'Завсегдатай',
      condition: '50 прошедших кофе-райдов',
    });
    expect(achievementCardTexts(input({}, { code: 'routes_5', level: 'bronze' }))).toMatchObject({
      kicker: 'Достижение · Бронза',
      title: 'Путешественник',
      condition: 'Пройденные заезды по 5 разным маршрутам',
    });
  });
});

describe('число на значке', () => {
  it('порог текущего уровня у счётных; у разовых — нет; счётное без уровня — бронза', () => {
    expect(badgeCount('races_5', 'bronze')).toBe(5);
    expect(badgeCount('races_5', 'silver')).toBe(15);
    expect(badgeCount('routes_5', 'gold')).toBe(30);
    expect(badgeCount('rides_10', 'silver')).toBe(25);
    expect(badgeCount('rides_10', null)).toBe(10);
    expect(badgeCount('race_win', null)).toBeUndefined();
  });
});

describe('ключ кэша', () => {
  it('стабилен; меняется от шаблона, темы, кода, объекта, публичного названия, даты и имени', () => {
    const base = achievementCardHash(input());
    expect(achievementCardHash(input())).toBe(base);
    const variants = [
      input({ template: 'night' }),
      input({ themeId: 'chrono' }),
      input({}, { code: 'race_podium' }),
      input({}, { object: { kind: 'race', id: 'other', title: 'Минская сотка' } }),
      input({ objectTitle: null }),
      input({}, { factDate: '2026-10-05' }),
      input({ riderName: 'Анна К.' }),
    ];
    const hashes = new Set(variants.map(achievementCardHash));
    expect(hashes.size).toBe(variants.length);
    expect(hashes.has(base)).toBe(false);
  });

  it('версия рендера 3 (уровни) входит в ключ', () => {
    expect(STORY_CARD_POLICY.renderVersion).toBe(3);
    const before = achievementCardHash(input());
    const spy = vi.spyOn(STORY_CARD_POLICY, 'renderVersion', 'get').mockReturnValue(4 as 3);
    expect(achievementCardHash(input())).not.toBe(before);
    spy.mockRestore();
  });

  it('различает уровни при равных прочих входах (AC6)', () => {
    const at = (level: 'bronze' | 'silver' | 'gold') =>
      achievementCardHash(input({}, { code: 'races_5', level }));
    expect(new Set([at('bronze'), at('silver'), at('gold')]).size).toBe(3);
  });

  it('название объекта из фактов (не публичное) в ключ не входит — только `objectTitle`', () => {
    expect(
      achievementCardHash(
        input({}, { object: { kind: 'race', id: 'race', title: 'Другое из фактов' } }),
      ),
    ).toBe(achievementCardHash(input()));
  });
});

describe('разметка', () => {
  it('оба шаблона: метка, название, условие, объект, дата, бренд; глиф иконки и число счётного', () => {
    for (const template of ['line', 'night'] as const) {
      const texts = strings(tree(input({ template, riderName: 'Анна К.' })));
      for (const value of [
        'Достижение',
        'Победа',
        'Первое место в своей группе',
        'Гонка «Минская сотка»',
        'Анна К.',
        '4 октября 2026',
      ]) {
        expect(texts).toContain(value);
      }
      expect(texts).toContain(String.fromCodePoint(ACHIEVEMENT_BADGE_ICONS.race_win.glyph));
      const counted = strings(tree(input({ template }, { code: 'rides_10', level: 'silver' })));
      expect(counted).toContain('25');
      expect(counted).toContain('Достижение · Серебро');
      expect(counted).not.toContain('10');
    }
  });

  it('приватный маршрут — ни названия из фактов, ни id объекта на картинке', () => {
    const texts = strings(
      tree(
        input(
          { objectTitle: null },
          {
            code: 'route_first',
            object: { kind: 'route', id: 'route-id-secret', title: 'Мой секретный' },
          },
        ),
      ),
    ).join('\n');
    expect(texts).not.toContain('Мой секретный');
    expect(texts).not.toContain('route-id-secret');
  });

  it('цвета — роли темы: `line` — светлая схема, `night` — тёмная; диск — `action.primary`', () => {
    const light = achievementCardRenderInput(input());
    const dark = achievementCardRenderInput(input({ template: 'night' }));
    expect(light.colors.background).toBe(appThemes.classic.schemes.light.surface.default);
    expect(dark.colors.background).toBe(appThemes.classic.schemes.dark.surface.default);
    expect(light.badgeColors.disc).toBe(appThemes.classic.schemes.light.action.primary);
  });
});

describe('иконки значка', () => {
  it('у каждого несезонного кода каталога есть глиф в шрифте Material Symbols', async () => {
    const symbols = await symbolsFont();
    for (const code of ACHIEVEMENT_CODES) {
      if (isSeasonalCode(code)) continue;
      const glyph = String.fromCodePoint(ACHIEVEMENT_BADGE_ICONS[code].glyph);
      const svg = await renderCardSvg(
        node('div', { display: 'flex', fontFamily: 'symbols', fontSize: 100 }, glyph),
        [symbols],
        { width: 120, height: 120 },
      );
      expect(svg, code).toMatch(/<path [^>]*d="M/);
    }
  });
});

describe('рендер', () => {
  it('satori: SVG 1080×1920 с текстом в путях для обоих шаблонов', async () => {
    const fonts = [...(await storyCardFonts(appThemes.classic)), await symbolsFont()];
    for (const template of ['line', 'night'] as const) {
      const svg = await renderAchievementCardSvg(
        achievementCardRenderInput(input({ template })),
        fonts,
      );
      expect(svg).toMatch(/^<svg width="1080" height="1920"/);
      expect(svg).toContain('<path');
    }
  });
});
