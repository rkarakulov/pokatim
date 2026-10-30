/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { shareLink } from '@/lib/share-link';

import { ShareChoiceSheet } from './share-choice-sheet';

jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));

const share = jest.mocked(shareLink);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const link = {
  title: 'Минское кольцо',
  text: 'Минское кольцо — 86 км',
  path: '/routes/r1',
  image: { uri: 'file:///cache/og.png' },
};

async function open(props: Partial<Parameters<typeof ShareChoiceSheet>[0]> = {}) {
  const handlers = { onCard: jest.fn(), onClose: jest.fn(), onShared: jest.fn() };
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ShareChoiceSheet
        title="Поделиться"
        cardLabel="Карточка для сторис"
        link={link}
        testID="share-choice"
        {...handlers}
        {...props}
      />
    </SafeAreaProvider>,
  );
  return handlers;
}

afterEach(() => jest.clearAllMocks());

describe('ShareChoiceSheet', () => {
  it('заголовок, текст, «Карточка», «Ссылка», «Закрыть»; окно — modal', async () => {
    await open({ text: 'Пригласите друзей' });
    expect(screen.getByRole('heading', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(screen.getByText('Пригласите друзей')).toBeOnTheScreen();
    expect(screen.getByTestId('share-choice').props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByRole('button', { name: 'Карточка для сторис' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ссылка' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeOnTheScreen();
  });

  it('«Карточка» → onCard; «Закрыть» → onClose', async () => {
    const { onCard, onClose } = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Карточка для сторис' }));
    expect(onCard).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('«Ссылка» — shareLink синхронно в обработчике нажатия (с картинкой); отправлено — onShared', async () => {
    let resolve: (outcome: 'shared') => void = () => undefined;
    share.mockReturnValue(new Promise((done) => (resolve = done)));
    const { onShared, onClose } = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    // вызов — до любого await обработчика (Web Share требует жест пользователя)
    expect(share).toHaveBeenCalledWith(link);
    expect(onShared).not.toHaveBeenCalled();
    await act(async () => resolve('shared'));
    expect(onShared).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без onShared отправка закрывает шит (onClose)', async () => {
    share.mockResolvedValue('shared');
    const { onClose } = await open({ onShared: undefined });
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    await act(async () => undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('web без Web Share — «Ссылка скопирована»; меню закрыли — без баннера; ошибка — баннер', async () => {
    const { onShared } = await open();
    share.mockResolvedValueOnce('copied');
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(await screen.findByText('Ссылка скопирована')).toBeOnTheScreen();

    share.mockResolvedValueOnce('dismissed');
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    await act(async () => undefined);
    expect(screen.queryByText('Ссылка скопирована')).toBeNull();

    share.mockRejectedValueOnce(new Error('boom'));
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(await screen.findByText('Не удалось поделиться ссылкой.')).toBeOnTheScreen();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('без ссылки (`link: null`) — только «Карточка» и «Закрыть»', async () => {
    await open({ link: null });
    expect(screen.queryByRole('button', { name: 'Ссылка' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Карточка для сторис' })).toBeOnTheScreen();
  });
});
