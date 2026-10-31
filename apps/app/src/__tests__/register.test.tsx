/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RegisterResponse } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { INVITE_TTL_MS } from '@/features/invites/invite-state';
import { rememberInvite } from '@/features/invites/invite-storage';
import { api } from '@/lib/api';

import { EMAIL, REGISTRATION_TOKEN, registerResponse, storedValue } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');

const register = jest.mocked(api.register);
const inviteStored = () =>
  jest
    .requireMock<{ __store: Map<string, string> }>('expo-secure-store')
    .__store.has('pokatim.invite');
const submitButton = () => screen.getByRole('button', { name: 'Зарегистрироваться' });

beforeEach(() => jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' }));
afterEach(() => jest.clearAllMocks());

async function openRegister() {
  const router = await renderRouter(appRoutes, { initialUrl: '/register' });
  await screen.findByRole('header', { name: 'Создать аккаунт' });
  return router;
}

async function pickBirthDate(date: Date) {
  await fireEvent.press(screen.getByRole('button', { name: 'Дата рождения' }));
  await fireEvent(screen.getByTestId('date-picker'), 'valueChange', { nativeEvent: {} }, date);
  await fireEvent.press(screen.getByRole('button', { name: 'Готово' }));
}

async function fillValidForm(email = EMAIL) {
  await fireEvent.changeText(screen.getByLabelText('E-mail'), email);
  await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
  await pickBirthDate(new Date(1991, 2, 14));
  await fireEvent.press(
    screen.getByRole('checkbox', { name: /Соглашаюсь на обработку персональных данных/ }),
  );
}

const apiError = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });

describe('«Создать аккаунт»', () => {
  it('без согласия «Зарегистрироваться» выключена; отмеченная галочка её включает', async () => {
    await openRegister();
    expect(submitButton()).toBeDisabled();
    expect(
      screen.getByText('Приложение доступно с 18 лет.', { includeHiddenElements: true }),
    ).toBeOnTheScreen();

    await fillValidForm();
    expect(submitButton()).toBeEnabled();
  });

  it('ошибки полей при уходе с поля — тексты по кодам контракта', async () => {
    await openRegister();

    const email = screen.getByLabelText('E-mail');
    await fireEvent.changeText(email, 'ivan@');
    await fireEvent(email, 'blur');
    expect(await screen.findByText('Проверьте e-mail: в адресе ошибка.')).toBeOnTheScreen();

    const password = screen.getByLabelText('Пароль');
    await fireEvent.changeText(password, 'short');
    await fireEvent(password, 'blur');
    expect(await screen.findByText('Не короче 8 символов.')).toBeOnTheScreen();
  });

  it('младше 18 — ошибка у даты при уходе с поля вместо подсказки, кнопка выключена', async () => {
    await openRegister();
    await fillValidForm();

    await pickBirthDate(new Date(2010, 4, 12));
    expect(await screen.findByText('Регистрация доступна с 18 лет.')).toBeOnTheScreen();
    expect(screen.getByText('12 мая 2010')).toBeOnTheScreen();
    expect(
      screen.queryByText('Приложение доступно с 18 лет.', { includeHiddenElements: true }),
    ).toBeNull();
    expect(submitButton()).toBeDisabled();
  });

  it('сбой SecureStore после регистрации — сценарий продолжается с токеном в памяти', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setItem = jest.mocked(SecureStore.setItemAsync);
    const original = setItem.getMockImplementation();
    setItem.mockRejectedValue(new Error('Keychain unavailable'));
    register.mockResolvedValue(registerResponse);
    await openRegister();
    await fillValidForm();

    await fireEvent.press(submitButton());

    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('registration not persisted'));
    if (original) setItem.mockImplementation(original);
    warn.mockRestore();
  });

  it('успех: кнопка busy на время запроса, затем «Подтвердите e-mail», токен в SecureStore', async () => {
    let resolve: (value: RegisterResponse) => void = () => undefined;
    register.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = await openRegister();
    await fillValidForm(` ${EMAIL} `);

    await fireEvent.press(submitButton());
    expect(submitButton()).toBeBusy();
    expect(submitButton()).toBeDisabled();
    // пробелы автоподстановки срезает контракт
    expect(register).toHaveBeenCalledWith({
      email: EMAIL,
      password: 'velo-secret',
      birthDate: '1991-03-14',
      personalDataConsent: true,
    });

    await act(async () => resolve(registerResponse));
    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/check-email');
    expect(JSON.parse(storedValue('pokatim.registration') ?? '{}')).toMatchObject({
      registrationToken: REGISTRATION_TOKEN,
      email: EMAIL,
    });
  });

  it('код приглашения (P6, AC5): сохранённый — в запросе, после успеха стёрт; ошибка — код остаётся', async () => {
    await rememberInvite('K7M2PQX', Date.now());
    register.mockRejectedValueOnce(apiError(409, 'EMAIL_TAKEN'));
    await openRegister();
    await fillValidForm();
    await fireEvent.press(submitButton());
    expect(await screen.findByText('Этот e-mail уже зарегистрирован.')).toBeOnTheScreen();
    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ invite: 'K7M2PQX' }));
    expect(inviteStored()).toBe(true);

    register.mockResolvedValue(registerResponse);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    await fireEvent.press(submitButton());
    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ invite: 'K7M2PQX' }));
    expect(inviteStored()).toBe(false);
  });

  it('код старше 7 дней — в запросе нет invite (AC5)', async () => {
    await rememberInvite('K7M2PQX', Date.now() - INVITE_TTL_MS - 60_000);
    register.mockResolvedValue(registerResponse);
    await openRegister();
    await fillValidForm();
    await fireEvent.press(submitButton());
    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(register.mock.lastCall?.[0]).not.toHaveProperty('invite', expect.anything());
  });

  it('EMAIL_TAKEN — текст у поля и «Войти» рядом; кнопка выключена, пока адрес не изменён', async () => {
    register.mockRejectedValue(apiError(409, 'EMAIL_TAKEN'));
    const router = await openRegister();
    await fillValidForm();

    await fireEvent.press(submitButton());
    expect(await screen.findByText('Этот e-mail уже зарегистрирован.')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Войти' })).toHaveLength(2);
    expect(submitButton()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    expect(screen.queryByText('Этот e-mail уже зарегистрирован.')).toBeNull();
    expect(submitButton()).toBeEnabled();

    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.press(submitButton());
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Войти' }))[0]);
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('EMAIL_UNAVAILABLE — нейтральный текст у поля, без «Войти» рядом (D-07)', async () => {
    register.mockRejectedValue(apiError(409, 'EMAIL_UNAVAILABLE'));
    await openRegister();
    await fillValidForm();

    await fireEvent.press(submitButton());
    expect(
      await screen.findByText('Этот e-mail нельзя использовать для регистрации.'),
    ).toBeOnTheScreen();
    // остаётся только общая ссылка «Уже есть аккаунт? Войти»
    expect(screen.getAllByRole('button', { name: 'Войти' })).toHaveLength(1);
  });

  it('400 сервера — ошибки по полям из details', async () => {
    register.mockRejectedValue(
      apiError(400, 'VALIDATION_FAILED', { fields: [{ path: 'birthDate', code: 'AGE_BELOW_18' }] }),
    );
    await openRegister();
    await fillValidForm();

    await fireEvent.press(submitButton());
    expect(await screen.findByText('Регистрация доступна с 18 лет.')).toBeOnTheScreen();
  });

  it('нет сети / лимит — баннер над кнопкой, форма сохранена', async () => {
    register.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Network request failed')));
    register.mockRejectedValueOnce(apiError(429, 'RATE_LIMITED', { retryAfterSec: 3600 }));
    await openRegister();
    await fillValidForm();

    await fireEvent.press(submitButton());
    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('E-mail')).toHaveDisplayValue(EMAIL);

    await fireEvent.press(submitButton());
    expect(await screen.findByText('Слишком много попыток. Попробуйте позже.')).toBeOnTheScreen();
  });

  it('«Вернуться к регистрации» — форма сохранена, кроме пароля', async () => {
    register.mockResolvedValue(registerResponse);
    await openRegister();
    await fillValidForm();
    await fireEvent.press(submitButton());
    await screen.findByRole('header', { name: 'Подтвердите e-mail' });

    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться к регистрации' }));

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(screen.getByLabelText('E-mail')).toHaveDisplayValue(EMAIL);
    expect(screen.getByLabelText('Пароль')).toHaveDisplayValue('');
    expect(screen.getByText('14 марта 1991')).toBeOnTheScreen();
    expect(
      screen.getByRole('checkbox', { name: /Соглашаюсь на обработку персональных данных/ }),
    ).toBeChecked();
  });
});
