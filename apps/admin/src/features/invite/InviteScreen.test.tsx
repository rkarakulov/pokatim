// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, renderApp, unauthorized } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    resendVerification: vi.fn(),
    acceptInvitation: vi.fn(),
    signInTotp: vi.fn(),
    signInTotpSetup: vi.fn(),
    signInTotpSetupConfirm: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const TOKEN = 't'.repeat(43);
const CHALLENGE = 'c'.repeat(43);

/** Ссылка из письма: токен — во фрагменте адреса браузера. */
function openLink(hash = `#token=${TOKEN}`) {
  window.history.replaceState(null, '', `/admin/invite${hash}`);
  return renderApp('/invite');
}

beforeEach(() => {
  mocked.me.mockRejectedValue(unauthorized());
  mocked.health.mockReturnValue(new Promise(() => undefined));
  mocked.overview.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

const email = () => screen.getByLabelText('E-mail');
const submit = () => screen.getByRole('button', { name: 'Принять и войти' });

async function acceptAs(address = 'new@example.by') {
  await screen.findByRole('heading', { name: 'Приглашение в команду' });
  fireEvent.change(email(), { target: { value: address } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-enough' } });
  fireEvent.click(submit());
}

describe('«Приглашение в команду» (/invite, ADR-0026)', () => {
  it('токен из #token= — сразу убран из адреса; общий текст, подсказка о регистрации; без сессии — не «Вход»', async () => {
    const { router } = await openLink();
    expect(await screen.findByRole('heading', { name: 'Приглашение в команду' })).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(currentHref(router)).toBe('/admin/invite');
    expect(screen.getByText(/Нет аккаунта\? Зарегистрируйтесь в приложении/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Зарегистрироваться' }).getAttribute('href')).toBe(
      '/register',
    );
    expect(submit()).toHaveProperty('disabled', true);
  });

  it('принятие → signedIn → «Обзор»; запрос — токен, e-mail, пароль', async () => {
    mocked.acceptInvitation.mockResolvedValue({ state: 'signedIn', me: ME.admin });
    mocked.me.mockResolvedValue(ME.admin);
    const { router } = await openLink();
    await acceptAs();

    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    expect(mocked.acceptInvitation).toHaveBeenCalledWith({
      token: TOKEN,
      email: 'new@example.by',
      password: 'long-enough',
    });
    expect(currentHref(router)).toBe('/admin/');
  });

  it('totpRequired — шаг кода входа', async () => {
    mocked.acceptInvitation.mockResolvedValue({
      state: 'totpRequired',
      challenge: CHALLENGE,
      expiresInSec: 300,
    });
    await openLink();
    await acceptAs();
    expect(await screen.findByRole('heading', { name: 'Подтверждение входа' })).toBeTruthy();
  });

  it('verificationRequired — карточка «E-mail не подтверждён»', async () => {
    mocked.acceptInvitation.mockResolvedValue({
      state: 'verificationRequired',
      registrationToken: 'r'.repeat(43),
      email: 'new@example.by',
      resendAvailableInSec: 0,
    });
    await openLink();
    await acceptAs();
    expect(await screen.findByRole('heading', { name: 'E-mail не подтверждён' })).toBeTruthy();
  });

  it('410 — «Приглашение недействительно» и «Войти»; без токена в адресе — сразу так же', async () => {
    mocked.acceptInvitation.mockRejectedValue(httpError(410, 'PANEL_INVITATION_INVALID'));
    await openLink();
    await acceptAs();
    expect(
      await screen.findByRole('heading', { name: 'Приглашение недействительно' }),
    ).toBeTruthy();
    expect(screen.getByText(/попросите администратора отправить новое/)).toBeTruthy();
    cleanup();

    const { router } = await openLink('');
    expect(
      await screen.findByRole('heading', { name: 'Приглашение недействительно' }),
    ).toBeTruthy();
    expect(mocked.acceptInvitation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/sign-in'));
  });

  it('409 mismatch — под полем e-mail; 401 — «Неверный e-mail или пароль»; 429 — пауза, поля неактивны', async () => {
    mocked.acceptInvitation
      .mockRejectedValueOnce(httpError(409, 'PANEL_INVITATION_EMAIL_MISMATCH'))
      .mockRejectedValueOnce(httpError(401, 'INVALID_CREDENTIALS'))
      .mockRejectedValueOnce(httpError(429, 'RATE_LIMITED', { retryAfterSec: 120 }));
    await openLink();
    await acceptAs('other@example.by');
    expect(await screen.findByText(/Приглашение отправлено на другой адрес/)).toBeTruthy();
    expect(email().getAttribute('aria-invalid')).toBe('true');

    fireEvent.click(submit());
    expect(await screen.findByText('Неверный e-mail или пароль')).toBeTruthy();

    fireEvent.click(submit());
    expect(await screen.findByText('Слишком много попыток')).toBeTruthy();
    expect(email()).toHaveProperty('disabled', true);
  });
});
