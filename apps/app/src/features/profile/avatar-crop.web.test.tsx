/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react';

import { AvatarCrop } from './avatar-crop.web';

const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
const createObjectURL = jest.fn(() => 'blob:avatar');
const revokeObjectURL = jest.fn();

/** jsdom без `PointerEvent`: событие указателя — `MouseEvent` с `pointerId` (координаты и захват — как в браузере). */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const disabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true';

beforeAll(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  if (!('PointerEvent' in window)) Object.assign(window, { PointerEvent: TestPointerEvent });
});
afterEach(() => {
  jest.clearAllMocks();
});

function renderCrop(width = 1200, height = 800) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const onTooSmall = jest.fn();
  const onUnreadable = jest.fn();
  const view = render(
    <AvatarCrop
      file={file}
      saving={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onTooSmall={onTooSmall}
      onUnreadable={onUnreadable}
    />,
  );
  const image = view.container.querySelector('img');
  if (!image) throw new Error('нет фото');
  if (width > 0) {
    Object.defineProperty(image, 'naturalWidth', { value: width });
    Object.defineProperty(image, 'naturalHeight', { value: height });
    fireEvent.load(image);
  }
  const area = screen.getByRole('group', { name: 'Область фото' });
  return { view, image, area, onConfirm, onCancel, onTooSmall, onUnreadable };
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }));
const zoomIn = () => screen.getByRole('button', { name: 'Увеличить' });
const zoomOut = () => screen.getByRole('button', { name: 'Уменьшить' });

describe('AvatarCrop (web, rider-profile AC14)', () => {
  it('окно — группа с меткой и подсказкой, фокус клавиатурой; начало — центральный квадрат', () => {
    const { area, onConfirm } = renderCrop();
    expect(area.getAttribute('tabindex')).toBe('0');
    // описание — подсказка про клавиши, не повтор метки
    const hint = document.getElementById(area.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Стрелки — сдвиг, плюс и минус — масштаб');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(disabled(zoomOut())).toBe(true);
    save();
    expect(onConfirm).toHaveBeenCalledWith({ x: 200 / 1200, y: 0, size: 1 });
  });

  it('клавиши: «+» — масштаб, стрелки — сдвиг (Shift — крупнее), «-» — обратно; лишние клавиши не перехватываются', () => {
    const { area, onConfirm } = renderCrop();
    fireEvent.keyDown(area, { key: '+' });
    // сторона 640 из 800: центр (600, 400) → квадрат от (280, 80)
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    fireEvent.keyDown(area, { key: 'ArrowUp', shiftKey: true });
    save();
    const [crop] = onConfirm.mock.calls[0] as [{ x: number; y: number; size: number }];
    expect(crop.size).toBeCloseTo(0.8);
    expect(crop.x * 1200).toBeCloseTo(280 - 32);
    expect(crop.y * 800).toBeCloseTo(0);

    fireEvent.keyDown(area, { key: '-' });
    save();
    expect((onConfirm.mock.calls[1] as [{ size: number }])[0].size).toBe(1);

    const tab = fireEvent.keyDown(area, { key: 'Tab' });
    expect(tab).toBe(true);
  });

  it('перетаскивание указателем — квадрат сдвигается против движения пальца', () => {
    const { area, onConfirm } = renderCrop();
    Object.defineProperty(area, 'clientWidth', { value: 300 });
    Object.assign(area, { setPointerCapture: jest.fn() });
    fireEvent.click(zoomIn());
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 130, clientY: 100 });
    fireEvent.pointerUp(area, { pointerId: 1 });
    save();
    const [crop] = onConfirm.mock.calls[0] as [{ x: number }];
    // сторона 640 px на 300 px окна: 30 px вправо → квадрат на 64 px влево от 280
    expect(crop.x * 1200).toBeCloseTo(280 - 64);
    expect(area.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('кнопки масштаба выключаются на пределах (не мельче 64 px исходника)', () => {
    renderCrop(128, 128);
    expect(disabled(zoomOut())).toBe(true);
    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    expect(disabled(zoomIn())).toBe(true);
    expect(disabled(zoomOut())).toBe(false);
  });

  it('фото меньше 64 × 64 — onTooSmall без отправки', () => {
    const { onTooSmall, onConfirm } = renderCrop(40, 600);
    expect(onTooSmall).toHaveBeenCalledTimes(1);
    save();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('файл не декодируется браузером — onUnreadable, сохранить нельзя', () => {
    const { image, onUnreadable, onConfirm } = renderCrop(0, 0);
    fireEvent.error(image);
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    save();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('«Отмена» и размонтирование — URL фото освобождается', () => {
    const { view, onCancel } = renderCrop();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });
});
