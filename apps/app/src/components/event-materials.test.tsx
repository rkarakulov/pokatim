/// <reference types="jest" />
import type { EventMaterial } from '@pokatim/contracts';
import { size, typography } from '@pokatim/design-tokens';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { downloadFile } from '@/lib/download-file';
import { openExternalUrl } from '@/lib/open-external-url';

import { EventMaterials, EventMaterialsSkeleton } from './event-materials';

jest.mock('@/lib/api', () => ({
  api: { eventFileUrl: (id: string) => `https://api.test/v1/event-files/${id}` },
}));
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/lib/download-file', () => ({ downloadFile: jest.fn() }));

const open = jest.mocked(openExternalUrl);
const download = jest.mocked(downloadFile);
const FILE_ID = 'b'.repeat(43);

const material = (overrides: Partial<EventMaterial>): EventMaterial => ({
  id: '0190a6f4-0000-7000-8000-0000000000f1',
  type: 'rules',
  title: 'Положение',
  description: null,
  url: null,
  file: null,
  ...overrides,
});

const link = material({
  id: '0190a6f4-0000-7000-8000-0000000000f1',
  type: 'link',
  title: 'Регламент на сайте',
  description: 'Полная версия регламента',
  url: 'https://www.example.by/rules',
});
const pdf = material({
  id: '0190a6f4-0000-7000-8000-0000000000f2',
  type: 'pdf',
  title: 'Схема старта',
  file: { id: FILE_ID, name: 'start.pdf', size: 1258291 },
});
const text = material({
  id: '0190a6f4-0000-7000-8000-0000000000f3',
  type: 'parking',
  title: 'Парковка',
  description: 'Парковка у стадиона, въезд с улицы Кальварийской до 7:30.',
});

beforeEach(() => {
  open.mockResolvedValue(undefined);
  download.mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('EventMaterials (plan-C §7)', () => {
  it('пусто — блока нет', async () => {
    await render(<EventMaterials materials={[]} />);
    expect(screen.queryByTestId('event-materials')).toBeNull();
    expect(screen.queryByText('Материалы')).toBeNull();
  });

  it('строки по порядку: заголовок, название, описание, подпись типа (домен / PDF · размер)', async () => {
    await render(<EventMaterials materials={[link, pdf, text]} />);
    expect(screen.getByText('Материалы')).toBeOnTheScreen();
    const titles = screen.getAllByText(/Регламент на сайте|Схема старта|Парковка$/);
    expect(titles.map((node) => node.props.children)).toEqual([
      'Регламент на сайте',
      'Схема старта',
      'Парковка',
    ]);
    expect(screen.getByText('Полная версия регламента')).toBeOnTheScreen();
    expect(screen.getByText('example.by')).toBeOnTheScreen();
    expect(screen.getByText('PDF · 1,2 МБ')).toBeOnTheScreen();
  });

  it('ссылка: роль link, подпись и подсказка; нажатие — openExternalUrl с адресом', async () => {
    await render(<EventMaterials materials={[link]} />);
    const row = screen.getByRole('link', {
      name: 'Регламент на сайте. Полная версия регламента. example.by',
    });
    expect(row).toHaveProp('accessibilityHint', 'Откроется в браузере');
    await fireEvent.press(row);
    expect(open).toHaveBeenCalledWith('https://www.example.by/rules');
    expect(download).not.toHaveBeenCalled();
  });

  it('PDF: кнопка «Скачать PDF» — downloadFile по адресу файла API', async () => {
    await render(<EventMaterials materials={[pdf]} />);
    const row = screen.getByRole('button', { name: 'Схема старта. PDF · 1,2 МБ' });
    expect(row).toHaveProp('accessibilityHint', 'Скачать PDF');
    await fireEvent.press(row);
    expect(download).toHaveBeenCalledWith(`https://api.test/v1/event-files/${FILE_ID}`);
    expect(open).not.toHaveBeenCalled();
  });

  it('текст без ссылки: описание в две строки, нажатие раскрывает и сворачивает', async () => {
    await render(<EventMaterials materials={[text]} />);
    const row = screen.getByRole('button', { name: `Парковка. ${text.description}` });
    const description = screen.getByText(text.description!);
    expect(description).toHaveProp('numberOfLines', 2);
    expect(row).not.toBeExpanded();

    await fireEvent.press(row);
    expect(screen.getByText(text.description!)).not.toHaveProp('numberOfLines');
    expect(row).toBeExpanded();
    expect(row).toHaveProp('accessibilityHint', 'Свернуть');

    await fireEvent.press(row);
    expect(screen.getByText(text.description!)).toHaveProp('numberOfLines', 2);
    expect(open).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('небезопасная ссылка (http) — без открытия и без домена', async () => {
    await render(
      <EventMaterials
        materials={[
          material({ title: 'Старый сайт', description: 'Описание', url: 'http://x.by' }),
        ]}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Старый сайт. Описание' }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText('x.by')).toBeNull();
  });

  it('ошибка открытия — баннер; следующее удачное нажатие его снимает', async () => {
    open.mockRejectedValueOnce(new Error('no browser'));
    await render(<EventMaterials materials={[link]} />);
    const row = screen.getByRole('link', {
      name: 'Регламент на сайте. Полная версия регламента. example.by',
    });
    await fireEvent.press(row);
    expect(await screen.findByText('Не удалось открыть материал.')).toBeOnTheScreen();

    await fireEvent.press(row);
    expect(screen.queryByText('Не удалось открыть материал.')).toBeNull();
  });

  it('пустой список с баннером (ошибка обновления) — секция с баннером, без строк', async () => {
    await render(<EventMaterials materials={[]} notice={<Text>Ошибка обновления</Text>} />);
    expect(screen.getByText('Материалы')).toBeOnTheScreen();
    expect(screen.getByText('Ошибка обновления')).toBeOnTheScreen();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('EventMaterialsSkeleton', () => {
  it('две строки раскладки материала: место иконки, название, описание в две строки, подпись; для скринридера — «Загрузка»', async () => {
    await render(<EventMaterialsSkeleton />);
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    const rows = screen.getAllByTestId('event-material-skeleton-row', {
      includeHiddenElements: true,
    });
    expect(rows).toHaveLength(2);
    // в каждой строке: место иконки (квадрат `size.icon`), название, описание в две строки, подпись — по кеглю стиля
    const heights = [
      typography.titleSm.size,
      typography.body.size,
      typography.body.size,
      typography.meta.size,
    ];
    for (const row of rows) {
      const [icon, ...lines] = within(row).getAllByTestId('skeleton', {
        includeHiddenElements: true,
      });
      expect(icon).toHaveStyle({ width: size.icon, height: size.icon });
      expect(lines.map((line) => StyleSheet.flatten(line.props.style).height)).toEqual(heights);
    }
  });
});
