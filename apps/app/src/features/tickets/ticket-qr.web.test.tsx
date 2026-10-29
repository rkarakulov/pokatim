/// <reference types="jest" />
import { appThemes } from '@pokatim/design-tokens';
import { render } from '@testing-library/react';

import { QR } from './fixtures';
import { qrMatrix } from './qr-matrix';
import { TicketQr } from './ticket-qr';

describe('TicketQr web (RC-B5)', () => {
  it('inline svg с path матрицы, цвета ролей ticket.*, подпись для скринридера без содержимого QR', () => {
    const { container } = render(<TicketQr payload={QR} size={240} />);
    const svg = container.querySelector('svg[data-testid="ticket-qr"]')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('QR-код билета');
    expect(svg.getAttribute('viewBox')).toBe('0 0 41 41');
    expect(svg.getAttribute('width')).toBe('240');
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(qrMatrix(QR).path);
    const ticket = appThemes.classic.schemes.light.ticket;
    expect(path.getAttribute('fill')).toBe(ticket.qrInk);
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe(ticket.qrPaper);
    expect(container.innerHTML).not.toContain('PKT1');
  });
});
