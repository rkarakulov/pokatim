// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileButton } from './FileButton';
import { LinePreview, projectLine } from './LinePreview';

afterEach(() => {
  cleanup();
});

describe('FileButton', () => {
  it('доступное имя, accept, скрытый input вне порядка фокуса; выбор файла — onFile, повтор того же — снова', () => {
    const onFile = vi.fn();
    render(<FileButton label="Загрузить GPX" accept=".gpx" onFile={onFile} />);
    const button = screen.getByRole('button', { name: 'Загрузить GPX' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.gpx');
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('aria-hidden')).toBe('true');

    const click = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['<gpx/>'], 'Кольцо.gpx', { type: 'application/gpx+xml' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledTimes(2);
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('busy — кнопка неактивна', () => {
    render(<FileButton label="Загрузить GPX" accept=".gpx" onFile={() => undefined} busy />);
    expect(
      (screen.getByRole('button', { name: 'Загрузить GPX' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('LinePreview', () => {
  it('проекция: длинная сторона 1000, пропорции по cos широты, ось Y вниз', () => {
    // 0,01° долготы на широте 60° ≈ вдвое короче 0,01° широты
    const projected = projectLine([
      [30, 60],
      [30.01, 60],
      [30.01, 60.01],
    ]);
    expect(projected).not.toBeNull();
    expect(projected!.height).toBe(1000);
    expect(projected!.width).toBeCloseTo(500, -1);
    const [start, , end] = projected!.path.split(' ');
    expect(start).toBe('0,1000');
    expect(end?.endsWith(',0')).toBe(true);
    expect(projectLine([[30, 60]])).toBeNull();
    expect(
      projectLine([
        [30, 60],
        [30, 60],
      ]),
    ).toBeNull();
  });

  it('картинка с текстовой альтернативой; линия — класс с токенами, без цветов и px в разметке', () => {
    render(
      <LinePreview
        points={[
          [27.5, 53.9],
          [27.6, 53.95],
        ]}
        label="Линия маршрута «Кольцо», 86,0 км"
      />,
    );
    const image = screen.getByRole('img', { name: 'Линия маршрута «Кольцо», 86,0 км' });
    expect(image.querySelector('polyline')?.getAttribute('class')).toBe('line-preview__line');
    expect(image.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|stroke=|\dpx/i);

    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    const rule = css.slice(css.indexOf('.line-preview__line'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/stroke: var\(--color-map-route\)/);
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/stroke-width: var\(--stroke-indicator\)/);
  });
});
