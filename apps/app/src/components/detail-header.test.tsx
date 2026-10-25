/// <reference types="jest" />
import { Link } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { DetailHeader } from './detail-header';

const routes = {
  index: () => (
    <Link href="/detail">
      <Text>Открыть</Text>
    </Link>
  ),
  races: () => <Text>Вкладка гонок</Text>,
  detail: () => <DetailHeader title="Гравийный коридор" fallback="/races" />,
};

describe('DetailHeader', () => {
  it('история есть — «Назад» возвращает на предыдущий экран', async () => {
    const router = await renderRouter(routes, { initialUrl: '/' });
    await fireEvent.press(screen.getByText('Открыть'));
    expect(router.getPathname()).toBe('/detail');
    expect(screen.getByRole('header', { name: 'Гравийный коридор' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(router.getPathname()).toBe('/');
  });

  it('истории нет (открыли по ссылке) — «Назад» ведёт на fallback', async () => {
    const router = await renderRouter(routes, { initialUrl: '/detail' });
    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(router.getPathname()).toBe('/races');
    expect(screen.getByText('Вкладка гонок')).toBeOnTheScreen();
  });
});
