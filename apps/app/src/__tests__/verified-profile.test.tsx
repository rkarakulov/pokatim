/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { VerifiedProfileView } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import ProfileScreen from '../app/settings/profile';
import VerifiedProfileScreen from '../app/settings/verified';
import { liveSession, signInForTest } from './auth-fixtures';
import { RACE_ID, verifiedView } from './races-fixtures';

jest.mock('@/lib/api');

const getVerifiedProfile = jest.mocked(api.getVerifiedProfile);
const updateVerifiedProfile = jest.mocked(api.updateVerifiedProfile);
const TOKEN = liveSession.accessToken;
/** 28 октября 2026 по Минску: последний допустимый год рождения — 2008. */
const NOW = new Date('2026-10-28T09:00:00Z');
const never = () => new Promise<never>(() => undefined);

const WEIGHT = 'Вес, кг';
const HEIGHT = 'Рост, см';
const FTP = 'FTP, Вт (необязательно)';
const YEAR = 'Год рождения';
const CONSENT = /Согласен на обработку анкеты/;

let client: QueryClient;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  getVerifiedProfile.mockResolvedValue(verifiedView());
  jest
    .mocked(api.getProfile)
    .mockResolvedValue({ rideReasons: [], publicName: null, showNameInResults: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

function open(url = '/settings/verified') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderRouter(
    {
      'settings/verified': VerifiedProfileScreen,
      'settings/profile': ProfileScreen,
      'races/[id]': () => null,
      index: () => null,
    },
    { initialUrl: url, wrapper },
  );
}

const save = () => screen.getByRole('button', { name: 'Сохранить' });
const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);

describe('«Анкета зачёта»: вход и загрузка (07c)', () => {
  it('ссылка из «Профиля» ведёт на анкету', async () => {
    const router = await open('/settings/profile');
    await fireEvent.press(await screen.findByRole('button', { name: 'Анкета зачёта' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/verified'));
    expect(await screen.findByRole('header', { name: 'Анкета зачёта' })).toBeOnTheScreen();
  });

  it('заголовок сразу, на месте полей — скелетон', async () => {
    getVerifiedProfile.mockReturnValue(never());
    await open();
    expect(await screen.findByRole('header', { name: 'Анкета зачёта' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByLabelText(WEIGHT)).toBeNull();
    expect(getVerifiedProfile).toHaveBeenCalledWith(TOKEN);
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка загрузки (%s) — «%s» с повтором', async (_case, error, title) => {
    getVerifiedProfile.mockRejectedValueOnce(error);
    await open();
    expect(await screen.findByText(title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText(WEIGHT)).toBeOnTheScreen();
  });
});

describe('«Анкета зачёта»: заполнение (07c)', () => {
  it('новая анкета — год из регистрации подставлен; тело PUT; кэш и «моё участие» обновлены', async () => {
    getVerifiedProfile.mockResolvedValue(verifiedView({ profile: null, suggestedBirthYear: 1990 }));
    let resolve: (view: VerifiedProfileView) => void = () => undefined;
    updateVerifiedProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    client.setQueryData(['races', 'entry', RACE_ID], { stale: false });
    await open();

    expect(await screen.findByDisplayValue('1990')).toBeOnTheScreen();
    expect(screen.getByLabelText(YEAR)).toHaveProp(
      'accessibilityHint',
      'Подставлен из регистрации — проверьте.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Женский' }));
    await type(WEIGHT, '58');
    await type(HEIGHT, '168');
    await fireEvent.press(screen.getByRole('checkbox', { name: CONSENT }));
    await fireEvent.press(save());

    await waitFor(() =>
      expect(updateVerifiedProfile).toHaveBeenCalledWith(TOKEN, {
        gender: 'w',
        birthYear: 1990,
        weightKg: 58,
        heightCm: 168,
        ftpW: null,
        consent: true,
      }),
    );
    expect(save()).toBeDisabled();
    const saved = verifiedView({
      profile: { ...verifiedView().profile!, gender: 'w', birthYear: 1990, weightKg: 58 },
    });
    resolve(saved);

    expect(await screen.findByText('Анкета сохранена')).toBeOnTheScreen();
    expect(client.getQueryData(['profile', 'verified'])).toEqual(saved);
    expect(client.getQueryState(['races', 'entry', RACE_ID])?.isInvalidated).toBe(true);
  });

  it('пустые поля и пределы — ошибки под полями, без запроса', async () => {
    getVerifiedProfile.mockResolvedValue(verifiedView({ profile: null }));
    await open();
    await screen.findByLabelText(WEIGHT);

    await type(YEAR, '2010');
    await type(WEIGHT, '25');
    await type(HEIGHT, '180.5');
    await type(FTP, '700');
    await fireEvent.press(save());

    expect(await screen.findByText('Заполните поле.')).toBeOnTheScreen();
    expect(screen.getByText('Целое число от 1920 до 2008.')).toBeOnTheScreen();
    expect(screen.getByText('Целое число от 30 до 200.')).toBeOnTheScreen();
    expect(screen.getByText('Целое число от 120 до 220.')).toBeOnTheScreen();
    expect(screen.getByText('Целое число от 50 до 600.')).toBeOnTheScreen();
    expect(screen.getByText('Нужно согласие на обработку персональных данных.')).toBeOnTheScreen();
    expect(updateVerifiedProfile).not.toHaveBeenCalled();
  });

  it('границы пределов допустимы (30 кг, 220 см, FTP 50, год 2008)', async () => {
    updateVerifiedProfile.mockResolvedValue(verifiedView());
    await open();
    await screen.findByDisplayValue('72');

    await type(YEAR, '2008');
    await type(WEIGHT, '30');
    await type(HEIGHT, '220');
    await type(FTP, '50');
    await fireEvent.press(save());

    await waitFor(() =>
      expect(updateVerifiedProfile).toHaveBeenCalledWith(TOKEN, {
        gender: 'm',
        birthYear: 2008,
        weightKg: 30,
        heightCm: 220,
        ftpW: 50,
        consent: true,
      }),
    );
  });

  it('ошибка сервера по полю (400) — под полем', async () => {
    updateVerifiedProfile.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'weightKg', code: 'INVALID' }] },
      }),
    );
    await open();
    await screen.findByDisplayValue('72');
    await fireEvent.press(save());
    expect(await screen.findByText('Целое число от 30 до 200.')).toBeOnTheScreen();
  });

  it('сеть — баннер над кнопкой', async () => {
    updateVerifiedProfile.mockRejectedValue(new ApiNetworkError(new TypeError('offline')));
    await open();
    await screen.findByDisplayValue('72');
    await fireEvent.press(save());
    expect(await screen.findByRole('alert')).toBeOnTheScreen();
  });

  it('открыта из гонки (?race) — после сохранения возврат к гонке', async () => {
    updateVerifiedProfile.mockResolvedValue(verifiedView());
    const router = await open(`/settings/verified?race=${RACE_ID}`);
    await screen.findByDisplayValue('72');
    await fireEvent.press(save());
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });
});

describe('«Анкета зачёта»: пол и год зафиксированы (07c)', () => {
  it('пол и год — только чтение с пояснением; PUT шлёт прежние значения', async () => {
    getVerifiedProfile.mockResolvedValue(verifiedView({ demographicsLocked: true }));
    updateVerifiedProfile.mockResolvedValue(verifiedView({ demographicsLocked: true }));
    await open();

    expect(await screen.findByText('Мужской')).toBeOnTheScreen();
    expect(screen.getByText('1984')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Пол и год рождения зафиксированы заявкой Verified — изменить их может команда платформы.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Женский' })).toBeNull();
    expect(screen.queryByLabelText(YEAR)).toBeNull();

    await type(WEIGHT, '75');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(updateVerifiedProfile).toHaveBeenCalledWith(TOKEN, {
        gender: 'm',
        birthYear: 1984,
        weightKg: 75,
        heightCm: 180,
        ftpW: null,
        consent: true,
      }),
    );
  });

  it('409 VERIFIED_DEMOGRAPHICS_LOCKED — текст по коду, анкета перезапрошена (блокировка)', async () => {
    updateVerifiedProfile.mockRejectedValueOnce(
      new ApiHttpError(409, { code: 'VERIFIED_DEMOGRAPHICS_LOCKED', message: 'x' }),
    );
    updateVerifiedProfile.mockResolvedValue(verifiedView({ demographicsLocked: true }));
    await open();
    await screen.findByDisplayValue('72');
    getVerifiedProfile.mockResolvedValue(verifiedView({ demographicsLocked: true }));

    await fireEvent.press(screen.getByRole('button', { name: 'Женский' }));
    await type(YEAR, '1990');
    await type(WEIGHT, '75');
    await fireEvent.press(save());

    expect(
      await screen.findByText(
        'Пол и год рождения уже зафиксированы заявкой Verified — изменить их может команда платформы',
      ),
    ).toBeOnTheScreen();
    await waitFor(() => expect(getVerifiedProfile).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        'Пол и год рождения зафиксированы заявкой Verified — изменить их может команда платформы.',
      ),
    ).toBeOnTheScreen();

    // повторное сохранение: пол и год — серверные, правка веса сохранена (ревью pass 1)
    await fireEvent.press(save());
    await waitFor(() => expect(updateVerifiedProfile).toHaveBeenCalledTimes(2));
    expect(updateVerifiedProfile).toHaveBeenLastCalledWith(TOKEN, {
      gender: 'm',
      birthYear: 1984,
      weightKg: 75,
      heightCm: 180,
      ftpW: null,
      consent: true,
    });
  });

  it('открыта заблокированной, команда сменила пол и год — PUT шлёт актуальные (ревью pass 2)', async () => {
    const locked = verifiedView({ demographicsLocked: true });
    const changed = verifiedView({
      demographicsLocked: true,
      profile: { ...locked.profile!, gender: 'w', birthYear: 1990 },
    });
    getVerifiedProfile.mockResolvedValue(locked);
    updateVerifiedProfile.mockRejectedValueOnce(
      new ApiHttpError(409, { code: 'VERIFIED_DEMOGRAPHICS_LOCKED', message: 'x' }),
    );
    updateVerifiedProfile.mockResolvedValue(changed);
    await open();
    await screen.findByDisplayValue('72');
    getVerifiedProfile.mockResolvedValue(changed);

    await type(WEIGHT, '75');
    await fireEvent.press(save());
    expect(await screen.findByText('Женский')).toBeOnTheScreen();
    expect(screen.getByText('1990')).toBeOnTheScreen();

    await fireEvent.press(save());
    await waitFor(() => expect(updateVerifiedProfile).toHaveBeenCalledTimes(2));
    expect(updateVerifiedProfile).toHaveBeenLastCalledWith(TOKEN, {
      gender: 'w',
      birthYear: 1990,
      weightKg: 75,
      heightCm: 180,
      ftpW: null,
      consent: true,
    });
  });

  it('заблокирована, пол сервера незнаком — понятная ошибка вместо молчания, PUT не уходит', async () => {
    getVerifiedProfile.mockResolvedValue(
      verifiedView({
        demographicsLocked: true,
        profile: { ...verifiedView().profile!, gender: 'unknown' },
      }),
    );
    await open();
    await screen.findByDisplayValue('72');

    await fireEvent.press(save());
    expect(
      await screen.findByText(
        'Пол или год рождения в анкете не распознаны — обновите приложение или напишите в поддержку',
      ),
    ).toBeOnTheScreen();
    expect(updateVerifiedProfile).not.toHaveBeenCalled();
  });
});
