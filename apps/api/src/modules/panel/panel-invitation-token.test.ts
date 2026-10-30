import { createHmac } from 'node:crypto';

import { OpaqueToken } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { invitationTokenHash, panelInvitationToken } from './panel-invitation-token';

const SECRET = 'test-email-secret-test-email-secret-0';
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const OTHER_ID = ID.replace(/7$/, '8');

describe('panelInvitationToken', () => {
  it('детерминирован по id (ретрай письма — та же ссылка), 43 символа base64url', () => {
    const token = panelInvitationToken(SECRET, ID);
    expect(panelInvitationToken(SECRET, ID)).toBe(token);
    expect(OpaqueToken.safeParse(token).success).toBe(true);
    expect(panelInvitationToken(SECRET, OTHER_ID)).not.toBe(token);
    expect(panelInvitationToken(`${SECRET}x`, ID)).not.toBe(token);
  });

  it('назначение в HMAC: токен приглашения ≠ HMAC того же id без префикса и с чужим (QR билета)', () => {
    const hmac = (value: string) => createHmac('sha256', SECRET).update(value).digest('base64url');
    const token = panelInvitationToken(SECRET, ID);
    expect(token).toBe(hmac(`panel-invitation:${ID}`));
    expect(token).not.toBe(hmac(ID));
    expect(token).not.toBe(hmac(`ticket-qr:${ID}`));
  });

  it('в БД — sha256 токена (hex), не сам токен', () => {
    const token = panelInvitationToken(SECRET, ID);
    const hash = invitationTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});
