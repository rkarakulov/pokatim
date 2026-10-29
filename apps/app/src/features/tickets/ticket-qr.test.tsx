/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';

import { svgSupported } from '@/features/routes/svg-support';

import { QR } from './fixtures';
import { qrMatrix } from './qr-matrix';
import { TicketQr } from './ticket-qr';

jest.mock('@/features/routes/svg-support', () => ({ svgSupported: jest.fn(() => true) }));

describe('TicketQr native (RC-B5)', () => {
  it('Svg + Path матрицы после загрузки модуля; изображение с подписью без содержимого QR', async () => {
    await render(<TicketQr payload={QR} size={240} />);
    const path = await screen.findByTestId('svg-Path');
    expect(path).toHaveProp('d', qrMatrix(QR).path);
    expect(screen.getByTestId('svg-Svg')).toHaveProp('viewBox', '0 0 41 41');
    expect(screen.getByRole('image', { name: 'QR-код билета' })).toBeOnTheScreen();
  });

  it('модуля react-native-svg в сборке нет — «Обновите приложение» вместо QR', async () => {
    jest.mocked(svgSupported).mockReturnValueOnce(false);
    await render(<TicketQr payload={QR} size={240} />);
    expect(screen.getByText(/Обновите приложение/)).toBeOnTheScreen();
    expect(screen.queryByTestId('ticket-qr')).toBeNull();
  });
});
