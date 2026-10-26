/// <reference types="jest" />
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import UiKitScreen from '../app/ui-kit';
import { tabRoutes } from './app-routes';
import { signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

const app = { ...tabRoutes, 'ui-kit': UiKitScreen };

// вкладки — только после входа (гард и скелетон оболочки — auth-guard.test)
beforeEach(signInForTest);

// __DEV__ в типах RN — константа; в тестах переключаем как глобальное значение
const setDev = (value: boolean) => Object.assign(globalThis, { __DEV__: value });

describe('витрина компонентов', () => {
  const devFlag = __DEV__;
  afterEach(() => setDev(devFlag));

  it('в dev открывается с Главной и показывает все разделы', async () => {
    await renderRouter(app, { wrapper: createQueryWrapper() });

    await fireEvent.press(screen.getByRole('button', { name: 'Витрина компонентов' }));

    expect(await screen.findByRole('header', { name: 'Витрина компонентов' })).toBeOnTheScreen();
    for (const section of [
      'Кнопки',
      'Метки и статусы',
      'Баннеры',
      'Поля и выбор',
      'Участники',
      'Загрузка',
      'Пустое состояние',
    ]) {
      expect(screen.getByText(section)).toBeOnTheScreen();
    }
    expect(
      screen.getByRole('checkbox', { name: 'Соглашаюсь на обработку персональных данных' }),
    ).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).not.toBeChecked();
    // новые компоненты системы: DateField (значение, ошибка, disabled) и Button loading
    expect(screen.getAllByRole('button', { name: 'Дата рождения' })[0]).toHaveAccessibilityValue({
      text: '14 марта 1991',
    });
    expect(screen.getByText('Регистрация доступна с 18 лет.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Категория' })).toBeDisabled();
    expect(screen.getByRole('button', { busy: true })).toBeDisabled();
    // disabled-состояния тоже показаны на витрине
    expect(screen.getByRole('checkbox', { name: 'Недоступно' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Недоступно' })).toBeDisabled();
  });

  it('в production ссылки на Главной нет', async () => {
    setDev(false);
    await renderRouter(app, { wrapper: createQueryWrapper() });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Витрина компонентов' })).toBeNull();
  });
});
