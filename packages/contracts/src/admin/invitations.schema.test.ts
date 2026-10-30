import { describe, expect, it } from 'vitest';

import {
  INVITATION_EMAIL_STATES,
  InvitationAcceptRequest,
  InviteRequest,
  PanelInvitationList,
} from './invitations.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const token = 't'.repeat(43);

describe('InviteRequest', () => {
  it('e-mail, имя и роль; пробелы срезаются; лишние ключи — ошибка', () => {
    expect(
      InviteRequest.parse({ email: ' new@example.by ', displayName: ' Ольга ', role: 'moderator' }),
    ).toEqual({ email: 'new@example.by', displayName: 'Ольга', role: 'moderator' });
    expect(
      InviteRequest.safeParse({
        email: 'new@example.by',
        displayName: 'Ольга',
        role: 'moderator',
        status: 'accepted',
      }).success,
    ).toBe(false);
    expect(
      InviteRequest.safeParse({ email: 'x', displayName: 'Ольга', role: 'moderator' }).success,
    ).toBe(false);
    expect(
      InviteRequest.safeParse({ email: 'a@b.by', displayName: 'Ольга', role: 'owner' }).success,
    ).toBe(false);
    expect(
      InviteRequest.safeParse({ email: 'a@b.by', displayName: '', role: 'moderator' }).success,
    ).toBe(false);
  });
});

describe('InvitationAcceptRequest', () => {
  it('токен — ровно 43 символа base64url; лишние ключи — ошибка', () => {
    const body = { token, email: 'new@example.by', password: 'long-enough' };
    expect(InvitationAcceptRequest.parse(body)).toEqual(body);
    for (const bad of ['t'.repeat(42), 't'.repeat(44), `${'t'.repeat(42)}/`]) {
      expect(InvitationAcceptRequest.safeParse({ ...body, token: bad }).success, bad).toBe(false);
    }
    expect(InvitationAcceptRequest.safeParse({ ...body, role: 'admin' }).success).toBe(false);
    expect(InvitationAcceptRequest.safeParse({ ...body, password: '' }).success).toBe(false);
  });
});

describe('PanelInvitationList', () => {
  it('приглашение со сроком, признаком истечения и состоянием письма', () => {
    const list = {
      items: [
        {
          id: ID,
          email: 'new@example.by',
          displayName: 'Ольга',
          role: 'organizer',
          invitedBy: 'Админ',
          createdAt: '2026-10-30T10:00:00.000Z',
          expiresAt: '2026-11-06T10:00:00.000Z',
          expired: false,
          emailState: 'failed',
        },
      ],
      truncated: false,
    };
    expect(PanelInvitationList.parse(list)).toEqual(list);
    expect(INVITATION_EMAIL_STATES).toEqual(['pending', 'sent', 'failed']);
    expect(
      PanelInvitationList.safeParse({ ...list, items: [{ ...list.items[0], emailState: 'x' }] })
        .success,
    ).toBe(false);
  });
});
