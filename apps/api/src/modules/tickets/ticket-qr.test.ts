import { TicketQrPayload } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { parseQrPayload, qrHashOf, qrPayload, ticketQrToken } from './ticket-qr';

const SECRET = 'test-email-secret-test-email-secret-0';
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('QR билета (ADR-0021)', () => {
  it('токен детерминирован по id и секрету, 43 символа base64url; другой id или секрет — другой токен', () => {
    const token = ticketQrToken(SECRET, ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ticketQrToken(SECRET, ID)).toBe(token);
    expect(ticketQrToken(SECRET, `${ID.slice(0, -1)}9`)).not.toBe(token);
    expect(ticketQrToken(`${SECRET}x`, ID)).not.toBe(token);
  });

  it('содержимое QR — PKT1.<token> по схеме контракта, без id; разбор — обратно токен', () => {
    const token = ticketQrToken(SECRET, ID);
    const payload = qrPayload(token);
    expect(TicketQrPayload.parse(payload)).toBe(payload);
    expect(payload).not.toContain(ID);
    expect(parseQrPayload(payload)).toBe(token);
    expect(parseQrPayload(`PKT2.${token}`)).toBeNull();
    expect(parseQrPayload(token)).toBeNull();
  });

  it('в БД — sha256 токена (hex), не сам токен', () => {
    const token = ticketQrToken(SECRET, ID);
    expect(qrHashOf(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(qrHashOf(token)).not.toContain(token);
  });
});
