/// <reference types="jest" />
import type { EventMaterial } from '@pokatim/contracts';
import { fireEvent, render, screen } from '@testing-library/react';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { EventMaterials } from './event-materials';

jest.mock('@/lib/api', () => ({
  api: { eventFileUrl: (id: string) => `https://api.test/v1/event-files/${id}` },
}));

const FILE_ID = 'e'.repeat(43);
const link: EventMaterial = {
  id: '0190a6f4-0000-7000-8000-0000000000f1',
  type: 'link',
  title: 'Регламент',
  description: null,
  url: 'https://example.by/rules',
  file: null,
};
const pdf: EventMaterial = {
  id: '0190a6f4-0000-7000-8000-0000000000f2',
  type: 'pdf',
  title: 'Схема старта',
  description: null,
  url: null,
  file: { id: FILE_ID, name: 'start.pdf', size: 2048 },
};

afterEach(() => jest.restoreAllMocks());

describe('EventMaterials (web)', () => {
  it('ссылка — новая вкладка без opener и Referer, синхронно в обработчике нажатия', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    render(<EventMaterials materials={[link]} />, { wrapper: appThemeWrapper('classic') });
    fireEvent.click(screen.getByRole('link', { name: 'Регламент. example.by' }));
    expect(open).toHaveBeenCalledWith('https://example.by/rules', '_blank', 'noopener,noreferrer');
  });

  it('PDF — скачивание ссылкой <a download> в той же вкладке', () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.href).toBe(`https://api.test/v1/event-files/${FILE_ID}`);
      expect(this.hasAttribute('download')).toBe(true);
    });
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    render(<EventMaterials materials={[pdf]} />, { wrapper: appThemeWrapper('classic') });
    fireEvent.click(screen.getByRole('button', { name: 'Схема старта. PDF · 2 КБ' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
