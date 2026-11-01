// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFullscreen } from './use-fullscreen';

/** jsdom без Fullscreen API: `fullscreenEnabled`, `fullscreenElement`, `requestFullscreen`, `exitFullscreen` — подмена. */
const fake = { element: null as Element | null };

function Probe() {
  const target = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(target);
  return (
    <div ref={target} data-testid="target">
      <span>{fullscreen.supported ? 'есть' : 'нет'}</span>
      <span>{fullscreen.active ? 'развёрнуто' : 'свёрнуто'}</span>
      <button type="button" onClick={fullscreen.toggle}>
        переключить
      </button>
    </div>
  );
}

function enter(element: Element | null) {
  fake.element = element;
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

beforeEach(() => {
  fake.element = null;
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fake.element,
  });
  document.exitFullscreen = vi.fn(() => Promise.resolve());
  HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useFullscreen (карта и профиль на весь экран)', () => {
  it('переключатель разворачивает свой узел и сворачивает его же; состояние — по fullscreenchange', () => {
    render(<Probe />);
    const target = screen.getByTestId('target');
    expect(screen.getByText('есть')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(HTMLElement.prototype.requestFullscreen).mock.contexts[0]).toBe(target);

    enter(target);
    expect(screen.getByText('развёрнуто')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);

    enter(null);
    expect(screen.getByText('свёрнуто')).toBeTruthy();
  });

  it('развёрнут чужой узел — не «развёрнуто»', () => {
    render(<Probe />);
    enter(document.body);
    expect(screen.getByText('свёрнуто')).toBeTruthy();
  });

  it('отказ браузера (requestFullscreen отклонён) — без необработанной ошибки, остаётся «свёрнуто»', async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() =>
      Promise.reject(new TypeError('Permissions check failed')),
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    render(<Probe />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByText('свёрнуто')).toBeTruthy();
  });

  it('без Fullscreen API (fullscreenEnabled = false) — не поддерживается', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    render(<Probe />);
    expect(screen.getByText('нет')).toBeTruthy();
  });
});
