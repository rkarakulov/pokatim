/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { AccessibilityInfo, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { BottomSheet } from './bottom-sheet';
import { SHEET_ANIMATION_MS } from './bottom-sheet-snap';

const METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

function Harness({ onHeight }: { onHeight?: (height: number) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <BottomSheet
        expanded={expanded}
        onExpandedChange={setExpanded}
        onVisibleHeightChange={onHeight}
        collapseLabel="Свернуть панель"
        expandLabel="Развернуть панель"
        header={<Text>Дистанция 86 км</Text>}
      >
        <Text>Гонки на маршруте</Text>
      </BottomSheet>
    </SafeAreaProvider>
  );
}

const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
beforeEach(() => {
  reduceMotion.mockResolvedValue(true);
});

const grabber = () => screen.getByRole('button', { name: /панель$/ });
const body = () => screen.getByTestId('bottom-sheet-body');
/** jsdom без PointerEvent: событие мыши с `pointerId` (React читает его из нативного события). */
let clock = 0;
function pointer(type: string, target: Element, pointerId: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  // медленный палец: 400 мс между событиями — без броска (быстрее SHEET_FLING_VELOCITY не бывает)
  clock += 400;
  Object.defineProperty(event, 'timeStamp', { value: clock });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  act(() => {
    target.dispatchEvent(event);
  });
}
/** jsdom без раскладки: высоты тела и шторки — как у браузера */
function withHeights(sheet: number, bodyHeight: number) {
  Object.defineProperty(body(), 'offsetHeight', { value: bodyHeight, configurable: true });
  Object.defineProperty(screen.getByTestId('bottom-sheet'), 'offsetHeight', {
    value: sheet,
    configurable: true,
  });
}

describe('BottomSheet web (routes-04d, L4, L6, RC-1, RC-17)', () => {
  it('серверный рендер — развёрнута, «Свернуть панель» с aria-expanded, тело в разметке, без измерений и useId', () => {
    const html = renderToString(<Harness />);
    expect(html).toContain('aria-label="Свернуть панель"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Гонки на маршруте');
    expect(html).not.toContain('translateY');
    // id из useId (`«r0»`/`:r0:`) разошёлся бы при гидрации
    expect(html).not.toMatch(/«r|:r\d/);
  });

  it('клик по «чёрточке» сворачивает (тело — display: none) и разворачивает; aria-expanded меняется', async () => {
    render(<Harness />);
    await act(async () => undefined);
    expect(grabber().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(grabber());
    expect(grabber().getAttribute('aria-expanded')).toBe('false');
    expect(grabber().getAttribute('aria-label')).toBe('Развернуть панель');
    expect(body().style.display).toBe('none');
    expect(screen.getByText('Дистанция 86 км')).toBeTruthy();
    fireEvent.click(grabber());
    expect(grabber().getAttribute('aria-expanded')).toBe('true');
    expect(body().style.display).not.toBe('none');
  });

  it('клавиатура: «чёрточка» — нативная <button> в Tab-порядке (Enter и Space шлют click браузером)', async () => {
    render(<Harness />);
    await act(async () => undefined);
    const node = grabber();
    expect(node.tagName).toBe('BUTTON');
    expect(node.getAttribute('type')).toBe('button');
    node.focus();
    expect(document.activeElement).toBe(node);
    // браузер превращает Enter/Space на <button> в click — jsdom этого не делает, шлём click
    fireEvent.click(node);
    expect(node.getAttribute('aria-expanded')).toBe('false');
  });

  it('«чёрточка» на всю ширину шторки, полоса по центру: <button> в flex-колонке растягивается', async () => {
    render(<Harness />);
    await act(async () => undefined);
    // в блочном потоке <button> сжимается до содержимого (44 px у левого края)
    const box = grabber().parentElement as HTMLElement;
    expect(box.style.display).toBe('flex');
    expect(box.style.flexDirection).toBe('column');
    expect(['', 'stretch']).toContain(box.style.alignItems);
    expect(getComputedStyle(grabber()).alignItems).toBe('center');
  });

  it('свернуть, когда фокус в теле — фокус переходит на «чёрточку»', async () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <FocusHarness />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
    screen.getByRole('button', { name: 'Внутри' }).focus();
    fireEvent.click(grabber());
    expect(document.activeElement).toBe(grabber());
  });

  it('перетаскивание за шапку: вниз больше половины хода — свёрнута; клик после жеста — не тап', async () => {
    const onHeight = jest.fn();
    render(<Harness onHeight={onHeight} />);
    await act(async () => undefined);
    withHeights(380, 300);
    const header = screen.getByTestId('bottom-sheet-header');
    // жест начат на «чёрточке»: браузер пришлёт ей click после pointerup
    pointer('pointerdown', grabber(), 1, 100);
    pointer('pointermove', header, 1, 150);
    expect(screen.getByTestId('bottom-sheet').style.transform).toBe('translateY(50px)');
    pointer('pointermove', header, 1, 300);
    pointer('pointerup', header, 1, 300);
    expect(grabber().getAttribute('aria-expanded')).toBe('false');
    // клик, который браузер шлёт после перетаскивания, состояние не меняет
    fireEvent.click(grabber());
    expect(grabber().getAttribute('aria-expanded')).toBe('false');
    withHeights(80, 300);
    pointer('pointerdown', header, 2, 300);
    pointer('pointermove', header, 2, 280);
    expect(body().style.display).not.toBe('none');
    pointer('pointermove', header, 2, 100);
    pointer('pointerup', header, 2, 100);
    expect(grabber().getAttribute('aria-expanded')).toBe('true');
  });

  it('короткое перемещение — не перетаскивание; меньше половины хода — обратно развёрнута', async () => {
    render(<Harness />);
    await act(async () => undefined);
    withHeights(380, 300);
    const header = screen.getByTestId('bottom-sheet-header');
    pointer('pointerdown', header, 1, 100);
    pointer('pointermove', header, 1, 104);
    expect(screen.getByTestId('bottom-sheet').style.transform).toBe('');
    pointer('pointermove', header, 1, 200);
    pointer('pointerup', header, 1, 200);
    expect(grabber().getAttribute('aria-expanded')).toBe('true');
  });

  it('анимация: снап — переход transform за SHEET_ANIMATION_MS, затем свёрнута', async () => {
    reduceMotion.mockResolvedValue(false);
    jest.useFakeTimers();
    try {
      render(<Harness />);
      await act(async () => undefined);
      withHeights(380, 300);
      fireEvent.click(grabber());
      const sheet = screen.getByTestId('bottom-sheet');
      expect(sheet.style.transition).toContain(`${SHEET_ANIMATION_MS}ms`);
      expect(sheet.style.transform).toBe('translateY(300px)');
      expect(grabber().getAttribute('aria-expanded')).toBe('true');
      act(() => {
        jest.advanceTimersByTime(SHEET_ANIMATION_MS);
      });
      expect(grabber().getAttribute('aria-expanded')).toBe('false');
      expect(sheet.style.transform).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('видимая высота — наружу после монтирования и после снапа', async () => {
    const onHeight = jest.fn();
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    let height = 380;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === 'bottom-sheet' ? height : 0;
      },
    });
    try {
      render(<Harness onHeight={onHeight} />);
      await act(async () => undefined);
      expect(onHeight).toHaveBeenLastCalledWith(380);
      height = 80;
      fireEvent.click(grabber());
      await act(async () => undefined);
      expect(onHeight).toHaveBeenLastCalledWith(80);
    } finally {
      if (proto) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', proto);
    }
  });
});

describe('BottomSheet web: ревью pass 1', () => {
  it('L2: перетаскивание за строку цифр (не «чёрточку») — следующее нажатие «чёрточки» не теряется', async () => {
    render(<Harness />);
    await act(async () => undefined);
    withHeights(380, 300);
    const stats = screen.getByText('Дистанция 86 км');
    pointer('pointerdown', stats, 1, 100);
    pointer('pointermove', stats, 1, 120);
    pointer('pointerup', stats, 1, 120);
    expect(grabber().getAttribute('aria-expanded')).toBe('true');
    // клавиатура: Enter на <button> — click
    fireEvent.click(grabber());
    expect(grabber().getAttribute('aria-expanded')).toBe('false');
  });

  it('L2: клик не пришёл после жеста на «чёрточке» — флаг сбрасывается, следующее нажатие работает', async () => {
    jest.useFakeTimers();
    try {
      render(<Harness />);
      await act(async () => undefined);
      withHeights(380, 300);
      pointer('pointerdown', grabber(), 1, 100);
      pointer('pointermove', grabber(), 1, 120);
      pointer('pointerup', grabber(), 1, 120);
      act(() => {
        jest.runOnlyPendingTimers();
      });
      fireEvent.click(grabber());
      expect(grabber().getAttribute('aria-expanded')).toBe('false');
    } finally {
      jest.useRealTimers();
    }
  });

  it('L1: перетаскивание во время перехода — с текущего места, переход отменён', async () => {
    reduceMotion.mockResolvedValue(false);
    jest.useFakeTimers();
    try {
      render(<Harness />);
      await act(async () => undefined);
      withHeights(380, 300);
      fireEvent.click(grabber());
      const sheet = screen.getByTestId('bottom-sheet');
      // посреди перехода к 300 px вычисленный сдвиг — 180 px
      const computed = jest
        .spyOn(window, 'getComputedStyle')
        .mockReturnValue({ transform: 'matrix(1, 0, 0, 1, 0, 180)' } as CSSStyleDeclaration);
      const header = screen.getByTestId('bottom-sheet-header');
      pointer('pointerdown', header, 1, 100);
      pointer('pointermove', header, 1, 90);
      computed.mockRestore();
      expect(sheet.style.transform).toBe('translateY(170px)');
      act(() => {
        jest.advanceTimersByTime(SHEET_ANIMATION_MS * 2);
      });
      // отменённый переход шторку не свернул
      expect(grabber().getAttribute('aria-expanded')).toBe('true');
      pointer('pointermove', header, 1, -100);
      pointer('pointerup', header, 1, -100);
      act(() => {
        jest.advanceTimersByTime(SHEET_ANIMATION_MS);
      });
      expect(grabber().getAttribute('aria-expanded')).toBe('true');
      expect(sheet.style.transform).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });
});

function FocusHarness() {
  const [expanded, setExpanded] = useState(true);
  return (
    <BottomSheet
      expanded={expanded}
      onExpandedChange={setExpanded}
      collapseLabel="Свернуть панель"
      expandLabel="Развернуть панель"
      header={null}
    >
      <button type="button">Внутри</button>
    </BottomSheet>
  );
}

describe('BottomSheet web: форма темы (app-themes C1)', () => {
  it('верхние углы — shape.sheet темы (Атлас — 12 px)', () => {
    render(<Harness />, { wrapper: appThemeWrapper('atlas') });
    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.style.borderTopLeftRadius).toBe('12px');
    expect(sheet.style.borderTopRightRadius).toBe('12px');
  });
});
