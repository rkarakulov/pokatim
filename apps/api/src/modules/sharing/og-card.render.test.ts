import { ogCard } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import { ogBrandRenderInput, ogCardRenderInput, ogTree } from './og-card.png';
import { ogCardTree, ogTitleToken, textWidth } from './og-card.render';
import type { StoryCardChild, StoryCardNode } from './story-card.render';

const LINE: [number, number][] = [
  [27.5, 53.9],
  [27.6, 53.95],
  [27.7, 53.9],
];

const children = (node: StoryCardNode): StoryCardChild[] => {
  const c = node.props.children;
  return c === undefined ? [] : Array.isArray(c) ? c : [c];
};
const nodes = (node: StoryCardNode): StoryCardNode[] =>
  children(node).filter(
    (child): child is StoryCardNode => typeof child === 'object' && child !== null,
  );
const all = (node: StoryCardNode): StoryCardNode[] => [node, ...nodes(node).flatMap(all)];
const textsOf = (node: StoryCardNode): string[] =>
  all(node).flatMap((n) => children(n).filter((c): c is string => typeof c === 'string'));

describe('ogCardTree (og-images, D2)', () => {
  it('с линией — две колонки: текст и плитка ogCard.tile с svg', () => {
    const tree = ogCardTree(ogCardRenderInput(OG_FIXTURES.race, LINE));
    expect(tree.props.style).toMatchObject({ width: 1200, height: 630 });
    const [content] = nodes(tree);
    expect(content!.props.style).toMatchObject({
      flexDirection: 'row',
      width: 1200 - 2 * ogCard.insetX,
      height: 630 - 2 * ogCard.insetY,
    });
    const [column, tile] = nodes(content!);
    expect(column!.props.style).toMatchObject({ width: textWidth(true) });
    expect(tile!.props.style).toMatchObject({
      width: ogCard.tile.width,
      height: ogCard.tile.height,
    });
    expect(all(tile!).some((n) => n.type === 'svg')).toBe(true);
  });

  it('без линии — одна колонка во всю ширину, svg нет', () => {
    const tree = ogCardTree(ogCardRenderInput(OG_FIXTURES.ride, null));
    const [content] = nodes(tree);
    expect(nodes(content!)).toHaveLength(1);
    expect(nodes(content!)[0]!.props.style).toMatchObject({ width: 1200 - 2 * ogCard.insetX });
    expect(all(tree).some((n) => n.type === 'svg')).toBe(false);
  });

  it('метка, название (lineClamp 3), факты, бренд внизу', () => {
    const tree = ogCardTree(ogCardRenderInput(OG_FIXTURES.race, null));
    expect(textsOf(tree)).toEqual([
      'Гонка',
      'Минское кольцо',
      '24–26 октября 2026',
      '42,5 км · Шоссе',
      'Покатим',
    ]);
    const title = all(tree).find((n) => children(n).includes('Минское кольцо'))!;
    expect(title.props.style).toMatchObject({ lineClamp: ogCard.titleMaxLines });
    const [column] = nodes(nodes(tree)[0]!);
    const footer = nodes(column!).at(-1)!;
    expect(textsOf(footer)).toEqual(['Покатим']);
  });

  it('ступени кегля названия по длине', () => {
    expect(ogTitleToken('Коротко')).toBe(ogCard.text.title);
    expect(ogTitleToken('К'.repeat(40))).toBe(ogCard.text.titleMid);
    expect(ogTitleToken('К'.repeat(70))).toBe(ogCard.text.titleLong);
  });

  it('в разметке нет организатора и автора из фикстуры (AC4)', () => {
    const ride = {
      ...OG_FIXTURES.ride,
      facts: { ...OG_FIXTURES.ride.facts, organizerName: 'Иван Организатор', ownerUserId: 'u-1' },
    };
    const json = JSON.stringify(ogTree(ride, LINE));
    expect(json).not.toContain('Организатор');
    expect(json).not.toContain('u-1');
    const route = {
      ...ogFixture('route'),
      facts: { ...ogFixture('route').facts, author: 'Автор Маршрута' },
    };
    expect(JSON.stringify(ogTree(route, LINE))).not.toContain('Автор Маршрута');
  });
});

describe('ogBrandTree', () => {
  it('название и слоган, без колонтитула и плитки', () => {
    const tree = ogTree(OG_FIXTURES.brand, null);
    // название и есть бренд — без колонтитула «Покатим» (ревью pass 1)
    expect(textsOf(tree)).toEqual([
      'Покатим',
      'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    ]);
    expect(all(tree).some((n) => n.type === 'svg')).toBe(false);
    expect(ogBrandRenderInput(OG_FIXTURES.brand).texts.title).toBe('Покатим');
  });
});
