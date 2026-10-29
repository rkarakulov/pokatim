// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, networkError, renderApp, unauthorized } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    resendVerification: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const TOKEN = 'r'.repeat(43);

beforeEach(() => {
  mocked.me.mockRejectedValue(unauthorized());
  mocked.health.mockReturnValue(new Promise(() => undefined));
  mocked.overview.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

const email = () => screen.getByLabelText('E-mail');
const password = () => screen.getByLabelText('Пароль');
const submit = () => screen.getByRole('button', { name: 'Войти' });

function fill(address = 'olga@example.by', secret = 'long-enough') {
  fireEvent.change(email(), { target: { value: address } });
  fireEvent.change(password(), { target: { value: secret } });
}

async function signInAs(address = 'olga@example.by') {
  fill(address);
  fireEvent.click(submit());
}

describe('вход в панель — без сессии (AC9)', () => {
  it('/admin/ без сессии — «Вход в панель» с брендом, без «Сессия истекла»', async () => {
    const { router } = await renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
    expect(screen.getByText('Покатим')).toBeTruthy();
    expect(screen.getByText('Панель команды платформы')).toBeTruthy();
    expect(screen.getByText('Тот же e-mail и пароль, что в приложении Покатим.')).toBeTruthy();
    expect(screen.queryByText('Сессия истекла')).toBeNull();
    expect(currentHref(router)).toBe('/admin/sign-in');
  });

  it('«Забыли пароль?» — на /forgot-password приложения (тот же origin)', async () => {
    await renderApp('/sign-in');
    const link = await screen.findByRole('link', { name: 'Забыли пароль?' });
    expect(link.getAttribute('href')).toBe('/forgot-password');
  });

  it('«Войти» неактивна, пока пароль пуст', async () => {
    await renderApp('/sign-in');
    await screen.findByRole('heading', { name: 'Вход в панель' });
    fireEvent.change(email(), { target: { value: 'olga@example.by' } });
    expect(submit()).toHaveProperty('disabled', true);
    fireEvent.change(password(), { target: { value: 'x' } });
    expect(submit()).toHaveProperty('disabled', false);
  });

  it('неверные данные — баннер «Неверный e-mail или пароль»', async () => {
    mocked.signIn.mockRejectedValue(httpError(401, 'INVALID_CREDENTIALS'));
    await renderApp('/sign-in');
    await signInAs();
    expect(await screen.findByText('Неверный e-mail или пароль')).toBeTruthy();
    expect(mocked.signIn).toHaveBeenCalledWith({
      email: 'olga@example.by',
      password: 'long-enough',
    });
  });

  it('нет роли — «Нет доступа к панели» с введённым адресом и «Войти другим аккаунтом»', async () => {
    mocked.signIn.mockRejectedValue(httpError(403, 'PANEL_ACCESS_DENIED'));
    await renderApp('/sign-in');
    await signInAs(' rider@example.by ');

    expect(await screen.findByRole('heading', { name: 'Нет доступа к панели' })).toBeTruthy();
    expect(
      screen.getByText(
        'Аккаунт rider@example.by не входит в команду платформы. В приложении он работает как обычно.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Войти другим аккаунтом' }));
    expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
    expect((email() as HTMLInputElement).value).toBe('');
  });

  it('«E-mail не подтверждён»: повтор письма с токеном из ответа, затем пауза с отсчётом; «Вернуться ко входу»', async () => {
    // часы заморожены (Date и интервал отсчёта), остальные таймеры — настоящие: отсчёт детерминирован
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
    mocked.signIn.mockResolvedValue({
      state: 'verificationRequired',
      registrationToken: TOKEN,
      email: 'olga@example.by',
      resendAvailableInSec: 0,
    });
    mocked.resendVerification.mockResolvedValue({ resendAvailableInSec: 60 });
    await renderApp('/sign-in');
    await signInAs();

    expect(await screen.findByRole('heading', { name: 'E-mail не подтверждён' })).toBeTruthy();
    const resend = screen.getByRole('button', { name: 'Отправить письмо ещё раз' });
    expect(resend).toHaveProperty('disabled', false);
    fireEvent.click(resend);

    await waitFor(() => expect(resend).toHaveProperty('disabled', true));
    expect(mocked.resendVerification).toHaveBeenCalledWith({ registrationToken: TOKEN });
    expect(screen.getByText('Повторно — через 60 с')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText('Повторно — через 30 с')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resend).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Повторно — через/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
  });

  it('429 — «Слишком много попыток», поля и «Войти» неактивны до конца паузы', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocked.signIn.mockRejectedValue(httpError(429, 'RATE_LIMITED', { retryAfterSec: 900 }));
    await renderApp('/sign-in');
    await signInAs();

    expect(await screen.findByText('Слишком много попыток')).toBeTruthy();
    expect(screen.getByText('Попробуйте через 15 мин.')).toBeTruthy();
    expect(email()).toHaveProperty('disabled', true);
    expect(password()).toHaveProperty('disabled', true);
    expect(submit()).toHaveProperty('disabled', true);

    await vi.advanceTimersByTimeAsync(901_000);
    await waitFor(() => expect(screen.queryByText('Слишком много попыток')).toBeNull());
    expect(email()).toHaveProperty('disabled', false);
  });

  it('нет сети — «Нет соединения…», без навигации', async () => {
    mocked.signIn.mockRejectedValue(networkError());
    await renderApp('/sign-in');
    await signInAs();
    expect(await screen.findByText(/Нет соединения/)).toBeTruthy();
  });

  it('неверный e-mail — ошибка под полем, запрос не уходит', async () => {
    await renderApp('/sign-in');
    await screen.findByRole('heading', { name: 'Вход в панель' });
    fill('olga@', 'x');
    fireEvent.click(submit());
    expect(await screen.findByText('Проверьте e-mail: в адресе ошибка.')).toBeTruthy();
    expect(mocked.signIn).not.toHaveBeenCalled();
  });
});

describe('возврат после входа (AC9)', () => {
  it('глубокая ссылка без сессии — «Вход» с next, после входа — та же страница', async () => {
    mocked.signIn.mockResolvedValue({ state: 'signedIn', me: ME.admin });
    const { router } = await renderApp('/some/page?x=1');
    await screen.findByRole('heading', { name: 'Вход в панель' });
    expect(router.state.location.search).toEqual({ next: '/some/page?x=1' });

    mocked.me.mockResolvedValue(ME.admin);
    await signInAs();

    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeTruthy();
    expect(currentHref(router)).toBe('/admin/some/page?x=1');
  });

  it('401 на открытой странице — «Сессия истекла», после входа — возврат на неё', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.overview.mockRejectedValue(unauthorized());
    const { router } = await renderApp('/');

    expect(await screen.findByText('Сессия истекла')).toBeTruthy();
    expect(screen.getByText('Войдите снова — откроется та же страница.')).toBeTruthy();
    expect(router.state.location.search).toEqual({ reason: 'expired', next: '/' });

    mocked.overview.mockReturnValue(new Promise(() => undefined));
    mocked.signIn.mockResolvedValue({ state: 'signedIn', me: ME.admin });
    await signInAs();
    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    expect(currentHref(router)).toBe('/admin/');
  });

  it.each(['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)'])(
    'next с чужим origin (%s) отбрасывается — после входа «Обзор»',
    async (next) => {
      mocked.signIn.mockResolvedValue({ state: 'signedIn', me: ME.admin });
      const { router } = await renderApp(`/sign-in?next=${encodeURIComponent(next)}`);
      await screen.findByRole('heading', { name: 'Вход в панель' });
      // проверенные параметры маршрута «Вход» — без next
      expect(router.state.matches.at(-1)?.search).toMatchObject({ next: undefined });

      mocked.me.mockResolvedValue(ME.admin);
      await signInAs();
      expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
      expect(currentHref(router)).toBe('/admin/');
    },
  );
});
