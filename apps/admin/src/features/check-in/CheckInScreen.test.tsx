// @vitest-environment jsdom
import type { CheckInView } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    lookupTicket: vi.fn(),
    checkInTicket: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const QR = `PKT1.${'a'.repeat(43)}`;

const view = (
  overrides: Partial<CheckInView> = {},
  ticket: Partial<CheckInView['ticket']> = {},
): CheckInView => ({
  outcome: 'ready',
  ticket: {
    code: '7XK2M9PQRT',
    status: 'active',
    participantName: 'Анна К.',
    category: { kind: 'calendar', distanceKm: 42.2 },
    event: {
      kind: 'calendar',
      id: '01890a5d-ac96-774b-bcce-b302099a8090',
      title: 'Минский марафон',
      startsAt: '2026-11-01T07:00:00.000Z',
      endsAt: null,
      place: 'Площадь',
      address: null,
      city: 'Минск',
    },
    checkedInAt: null,
    checkedInBy: null,
    ...ticket,
  },
  ...overrides,
});

/** Камера: поток с треками-шпионами и `BarcodeDetector`, «видящий» заданный QR. */
function fakeCamera(raw: string) {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  class Detector {
    static getSupportedFormats = async () => ['qr_code'];
    detect = async () => [{ rawValue: raw }];
  }
  vi.stubGlobal('BarcodeDetector', Detector);
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: () => Promise.resolve(),
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    value: 1280,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    value: 720,
    configurable: true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D);
  return { stop, getUserMedia };
}

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

const codeForm = () => screen.getByRole('form', { name: 'Код билета' });
const enterCode = (code: string) => {
  fireEvent.change(within(codeForm()).getByLabelText('Код билета'), { target: { value: code } });
  fireEvent.click(within(codeForm()).getByRole('button', { name: 'Найти' }));
};

describe('«Check-in» (AC6, RC-C2)', () => {
  it('без сайдбара; ручной код → карточка ready → «Отметить» → отмечен; «Следующий» — сброс', async () => {
    mocked.lookupTicket.mockResolvedValue(view());
    mocked.checkInTicket.mockResolvedValue(
      view(
        { outcome: 'checked_in' },
        { status: 'checked_in', checkedInAt: '2026-11-01T06:40:00.000Z', checkedInBy: 'Ира' },
      ),
    );
    await renderApp('/check-in');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('link', { name: '← В панель' })).toBeTruthy();
    enterCode('7xk2m-9pqrt');
    await waitFor(() => expect(mocked.lookupTicket).toHaveBeenCalledWith({ code: '7XK2M9PQRT' }));
    const result = screen.getByRole('status', { name: 'Результат проверки' });
    expect(await within(result).findByText('Билет действителен')).toBeTruthy();
    expect(within(result).getByText('Минский марафон')).toBeTruthy();
    expect(within(result).getByText('42,2 км')).toBeTruthy();
    fireEvent.click(within(result).getByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(mocked.checkInTicket).toHaveBeenCalledWith({ code: '7XK2M9PQRT' }));
    expect(await within(result).findByText('Участник отмечен в 01.11.2026, 09:40')).toBeTruthy();
    expect(within(result).queryByRole('button', { name: 'Отметить' })).toBeNull();
    fireEvent.click(within(result).getByRole('button', { name: 'Следующий' }));
    expect(within(result).queryByText('Минский марафон')).toBeNull();
  });

  it('во время отметки «Следующий» недоступен — поздний ответ не возвращает сброшенную карточку', async () => {
    mocked.lookupTicket.mockResolvedValue(view());
    let answer!: (value: CheckInView) => void;
    mocked.checkInTicket.mockReturnValue(new Promise<CheckInView>((resolve) => (answer = resolve)));
    await renderApp('/check-in');
    enterCode('7XK2M9PQRT');
    const result = screen.getByRole('status', { name: 'Результат проверки' });
    fireEvent.click(await within(result).findByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(mocked.checkInTicket).toHaveBeenCalled());
    const next = within(result).getByRole('button', { name: 'Следующий' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await act(async () => answer(view({ outcome: 'checked_in' }, { status: 'checked_in' })));
    await waitFor(() =>
      expect(
        (within(result).getByRole('button', { name: 'Следующий' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('кривой код — ошибка под полем без запроса; уже отмечен — время и сотрудник; отказы текстом', async () => {
    await renderApp('/check-in');
    enterCode('123');
    expect(within(codeForm()).getByLabelText('Код билета').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(mocked.lookupTicket).not.toHaveBeenCalled();

    mocked.lookupTicket.mockResolvedValueOnce(
      view(
        { outcome: 'already_checked_in' },
        { status: 'checked_in', checkedInAt: '2026-11-01T06:40:00.000Z', checkedInBy: 'Ира' },
      ),
    );
    enterCode('7XK2M9PQRT');
    expect(await screen.findByText('Уже отмечен 01.11.2026, 09:40 · Ира')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отметить' })).toBeNull();

    for (const [outcome, text] of [
      ['cancelled', 'Билет отменён — участие снято'],
      ['outside_window', 'Check-in для этого события сейчас закрыт'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Следующий' }));
      mocked.lookupTicket.mockResolvedValueOnce(view({ outcome }));
      enterCode('7XK2M9PQRT');
      expect(await screen.findByText(text)).toBeTruthy();
    }
    for (const [error, text] of [
      [httpError(404, 'NOT_FOUND'), 'Билет не найден или событие недоступно'],
      [httpError(429, 'RATE_LIMITED', { retryAfterSec: 30 }), 'Слишком часто — подождите минуту'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Следующий' }));
      mocked.lookupTicket.mockRejectedValueOnce(error);
      enterCode('7XK2M9PQRT');
      expect(await screen.findByText(text)).toBeTruthy();
    }
  });

  it('камера запрещена — сообщение, ручной ввод работает', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))),
      },
      configurable: true,
    });
    mocked.lookupTicket.mockResolvedValue(view());
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(
      await screen.findByText(
        'Доступ к камере запрещён — разрешите в настройках браузера или введите код',
      ),
    ).toBeTruthy();
    enterCode('7XK2M9PQRT');
    expect(await screen.findByText('Билет действителен')).toBeTruthy();
  });

  it('скан QR: один запрос (дедупликация, пауза при карточке); стоп треков при уходе', async () => {
    const camera = fakeCamera(QR);
    mocked.lookupTicket.mockResolvedValue(view());
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() =>
      expect(camera.getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: 'environment' },
        audio: false,
      }),
    );
    expect(await screen.findByText('Билет действителен')).toBeTruthy();
    expect(mocked.lookupTicket).toHaveBeenCalledWith({ qr: QR });
    // карточка на экране — кадры не разбираются; тот же QR — без нового запроса
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(mocked.lookupTicket).toHaveBeenCalledTimes(1);
    cleanup();
    expect(camera.stop).toHaveBeenCalled();
  });

  it('кадр распознан после начала ручного поиска — не запускает поиск; «Отметить» — по показанному билету', async () => {
    fakeCamera(QR);
    // первый кадр «распознаётся», когда скажет тест; следующие — пусто
    let decoded: (codes: { rawValue: string }[]) => void = () => undefined;
    let calls = 0;
    class SlowDetector {
      static getSupportedFormats = async () => ['qr_code'];
      detect = () =>
        (calls += 1) === 1
          ? new Promise<{ rawValue: string }[]>((done) => (decoded = done))
          : Promise.resolve([]);
    }
    vi.stubGlobal('BarcodeDetector', SlowDetector);
    let answerManual: (value: CheckInView) => void = () => undefined;
    mocked.lookupTicket.mockImplementation((body) =>
      'code' in body
        ? new Promise<CheckInView>((done) => (answerManual = done))
        : new Promise<CheckInView>(() => undefined),
    );
    mocked.checkInTicket.mockResolvedValue(
      view({ outcome: 'checked_in' }, { status: 'checked_in' }),
    );
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() => expect(calls).toBe(1));
    enterCode('BBBBBBBBBB');
    await waitFor(() => expect(mocked.lookupTicket).toHaveBeenCalledWith({ code: 'BBBBBBBBBB' }));
    await act(async () => decoded([{ rawValue: QR }]));
    await act(async () =>
      answerManual(view({}, { code: 'BBBBBBBBBB', participantName: 'Борис Б.' })),
    );
    const result = screen.getByRole('status', { name: 'Результат проверки' });
    expect(await within(result).findByText('Борис Б.')).toBeTruthy();
    expect(mocked.lookupTicket).toHaveBeenCalledTimes(1);
    fireEvent.click(within(result).getByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(mocked.checkInTicket).toHaveBeenCalledWith({ code: 'BBBBBBBBBB' }));
  });

  /** `getUserMedia`, отвечающий, когда тест скажет: поздний поток устаревшей попытки. */
  function deferredCamera() {
    const camera = fakeCamera(QR);
    let resolve: (stream: MediaStream) => void = () => undefined;
    camera.getUserMedia.mockImplementation(
      () => new Promise<MediaStream>((done) => (resolve = done)),
    );
    const stop = vi.fn();
    const late = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
    return { ...camera, lateStop: stop, answer: () => act(async () => resolve(late)) };
  }

  it('«Выключить» до ответа getUserMedia — поздний поток сразу остановлен, камера не включается', async () => {
    const camera = deferredCamera();
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Выключить камеру' }));
    await camera.answer();
    expect(camera.lateStop).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Включить камеру' })).toBeTruthy();
    expect(screen.queryByText('Наведите камеру на QR билета')).toBeNull();
  });

  it('уход со страницы до ответа getUserMedia — поздний поток сразу остановлен', async () => {
    const camera = deferredCamera();
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled());
    cleanup();
    await camera.answer();
    expect(camera.lateStop).toHaveBeenCalledTimes(2);
  });

  it('скрытие вкладки до ответа getUserMedia — поздний поток сразу остановлен', async () => {
    const camera = deferredCamera();
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      fireEvent(document, new Event('visibilitychange'));
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
    await camera.answer();
    expect(camera.lateStop).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Включить камеру' })).toBeTruthy();
  });

  it('чужой QR — «Это не билет «Покатим»» без запроса', async () => {
    fakeCamera('https://example.com/promo');
    await renderApp('/check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(await screen.findByText('Это не билет «Покатим»')).toBeTruthy();
    expect(mocked.lookupTicket).not.toHaveBeenCalled();
  });

  it('без права tickets.checkin — «Нет доступа»', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/check-in');
    expect(await screen.findByText('Нет доступа к разделу')).toBeTruthy();
  });
});
