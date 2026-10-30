import { z } from 'zod';

import { Uuid } from '../common.ts';
import { Email } from '../auth/registration.schema.ts';
import { SignInPassword } from '../auth/sign-in.schema.ts';
import { OpaqueToken } from '../auth/verification.schema.ts';
import { DisplayName } from './members.schema.ts';
import { PanelRole } from './permissions.schema.ts';

/** Предел блока «Приглашения» без пагинации (сервер и подпись «показаны первые N» в UI). */
export const PANEL_INVITATION_LIST_CAP = 200;

/** Срок жизни приглашения — 7 суток (ADR-0026); подпись «действует до» считает сервер (`expiresAt`). */
export const PANEL_INVITATION_TTL_DAYS = 7;

/** Состояние письма-приглашения: `failed` — все попытки исчерпаны («Письмо не отправлено» → «Отправить повторно»). */
export const INVITATION_EMAIL_STATES = ['pending', 'sent', 'failed'] as const;
export const InvitationEmailState = z.enum(INVITATION_EMAIL_STATES);
export type InvitationEmailState = z.infer<typeof InvitationEmailState>;

/**
 * Живое приглашение для блока «Приглашения» (`members.read`): e-mail адресата (виден команде, как в «Сотрудниках»),
 * имя в панели, роль, кто пригласил (имя; удалённый — «Удалённый участник»). `expired` — от сервера по его часам.
 */
export const PanelInvitation = z.object({
  id: Uuid,
  email: z.string(),
  displayName: z.string(),
  role: PanelRole,
  invitedBy: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  expired: z.boolean(),
  emailState: InvitationEmailState,
});
export type PanelInvitation = z.infer<typeof PanelInvitation>;

/** `GET /v1/admin/invitations` (`members.read`): `pending` (в т. ч. истёкшие), новые сверху, до cap. */
export const PanelInvitationList = z.object({
  items: z.array(PanelInvitation),
  truncated: z.boolean(),
});
export type PanelInvitationList = z.infer<typeof PanelInvitationList>;

/**
 * `POST /v1/admin/invitations` (`members.manage`) — пригласить адрес (аккаунта может не быть). Живое приглашение
 * того же адреса заменяется («Отправить повторно»); активный член — 409 `PANEL_ALREADY_MEMBER`; нет адреса панели на
 * сервере — 503 `PANEL_INVITATIONS_UNAVAILABLE`.
 */
export const InviteRequest = z.strictObject({
  email: Email,
  displayName: DisplayName,
  role: PanelRole,
});
export type InviteRequest = z.infer<typeof InviteRequest>;

/**
 * `POST /v1/admin/invitations/accept` (без сессии) — принять приглашение паролем аккаунта с тем же e-mail; ответ —
 * `PanelSignInResponse` (как вход). Токен — из фрагмента ссылки письма, в теле (не в URL). Недействительное
 * приглашение (неизвестно, истекло, отозвано, принято) — 410 `PANEL_INVITATION_INVALID`; e-mail аккаунта не тот — 409
 * `PANEL_INVITATION_EMAIL_MISMATCH`.
 */
export const InvitationAcceptRequest = z.strictObject({
  token: OpaqueToken,
  email: Email,
  password: SignInPassword,
});
export type InvitationAcceptRequest = z.infer<typeof InvitationAcceptRequest>;
