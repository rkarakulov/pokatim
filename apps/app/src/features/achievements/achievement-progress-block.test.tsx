/// <reference types="jest" />
import { AchievementList } from '@pokatim/contracts';
import { render, screen } from '@testing-library/react-native';

import { AchievementProgressBlock } from './achievement-progress-block';

const list = (progress: AchievementList['progress']): AchievementList => ({ items: [], progress });

describe('блок «Следующие цели» (L5, AC7)', () => {
  it('заголовок, строки «Гонщик · Серебро» и «7 из 15», полоса progressbar с a11y', async () => {
    await render(
      <AchievementProgressBlock
        query={{
          data: list([
            { code: 'races_5', level: 'silver', current: 7, target: 15 },
            { code: 'rides_10', level: 'bronze', current: 2, target: 10 },
          ]),
        }}
      />,
    );
    expect(screen.getByRole('header', { name: 'Следующие цели' })).toBeOnTheScreen();
    const bar = screen.getByRole('progressbar', { name: 'Гонщик, серебро: 7 из 15' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 15, now: 7 });
    expect(
      screen.getByRole('progressbar', { name: 'Завсегдатай, бронза: 2 из 10' }),
    ).toBeOnTheScreen();
    const hidden = { includeHiddenElements: true };
    expect(screen.getByText('Гонщик · Серебро', hidden)).toBeOnTheScreen();
    expect(screen.getByText('7 из 15', hidden)).toBeOnTheScreen();
  });

  it('незнакомые код и уровень отброшены; прогресса нет — блока нет', async () => {
    await render(
      <AchievementProgressBlock
        query={{
          data: list([
            { code: 'unknown', level: 'silver', current: 1, target: 3 },
            { code: 'races_5', level: 'unknown', current: 31, target: 40 },
          ]),
        }}
      />,
    );
    expect(screen.queryByText('Следующие цели')).toBeNull();
    await render(<AchievementProgressBlock query={{ data: list([]) }} />);
    expect(screen.queryByText('Следующие цели')).toBeNull();
  });

  it('загрузка или ошибка (данных нет) — блока нет; ответ старого API без progress — блока нет', async () => {
    await render(<AchievementProgressBlock query={{ data: undefined }} />);
    expect(screen.queryByText('Следующие цели')).toBeNull();
    const v1 = AchievementList.parse({ items: [] });
    await render(<AchievementProgressBlock query={{ data: v1 }} />);
    expect(screen.queryByText('Следующие цели')).toBeNull();
  });
});
