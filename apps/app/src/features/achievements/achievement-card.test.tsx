/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { knownItems } from './achievement-catalog';
import { AchievementCard } from './achievement-card';

const [win] = knownItems([
  {
    code: 'race_win',
    object: { kind: 'race', id: '0190a6f4-0000-7000-8000-000000000201', title: 'Гонка у озера' },
    factDate: '2026-05-02',
    level: null,
    seen: false,
  },
]);

afterEach(() => jest.restoreAllMocks());

describe('появление значка вспышки (LOW-1 ревью)', () => {
  it('ответ «Уменьшить движение» ещё неизвестен — значок скрыт без анимации (без кадра «виден → исчез»)', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => undefined));
    const timing = jest.spyOn(Animated, 'timing');
    await render(<AchievementCard item={win!} animated />);
    const pending = screen.getByTestId('achievement-badge-pending', {
      includeHiddenElements: true,
    });
    expect(pending).toHaveStyle({ opacity: 0 });
    expect(screen.queryByTestId('achievement-badge-static')).toBeNull();
    expect(screen.queryByTestId('achievement-badge-animated')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
  });

  it('экран достижения (без анимации) — значок виден сразу', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => undefined));
    await render(<AchievementCard item={win!} />);
    expect(screen.getByTestId('achievement-badge-static')).toBeOnTheScreen();
  });
});

describe('метка уровня (L6)', () => {
  it('счётное — метка текстом и число порога; разовое — без метки', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const [gold] = knownItems([{ ...win!, code: 'routes_5', level: 'gold' }]);
    await render(<AchievementCard item={gold!} />);
    expect(screen.getByText('Золото')).toBeOnTheScreen();
    expect(screen.getByText('Пройденные заезды по 30 разным маршрутам')).toBeOnTheScreen();
    expect(screen.getByText('30', { includeHiddenElements: true })).toBeOnTheScreen();
    await render(<AchievementCard item={win!} />);
    expect(screen.queryByText('Бронза')).toBeNull();
  });
});
