import { z } from 'zod';

import { fieldError, Uuid } from '../common.ts';
import { Email } from '../auth/registration.schema.ts';
import { PanelRole } from './permissions.schema.ts';

export const MEMBER_STATUSES = ['active', 'revoked'] as const;
export const MemberStatus = z.enum(MEMBER_STATUSES);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const DISPLAY_NAME_MAX_LENGTH = 80;
export const ACTION_REASON_MIN_LENGTH = 3;
export const ACTION_REASON_MAX_LENGTH = 500;

/** Имя сотрудника в панели (вводит админ при выдаче роли): 1–80 символов, без управляющих. */
export const DisplayName = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(1, { error: 'REQUIRED', abort: true })
  .max(DISPLAY_NAME_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(/^[^\p{Cc}]+$/u, { error: 'INVALID' });

/**
 * Причина чувствительного действия (уходит в append-only журнал): 3–500 символов; из управляющих — только перевод
 * строки `\n`.
 */
export const ActionReason = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(ACTION_REASON_MIN_LENGTH, { error: 'TOO_SHORT', abort: true })
  .max(ACTION_REASON_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(/^[^\p{Cc}]*(?:\n[^\p{Cc}]*)*$/u, { error: 'INVALID' });

/**
 * `POST /v1/admin/members` (`members.manage`) — выдать роль существующему подтверждённому пользователю приложения по
 * e-mail. Нет аккаунта — 404, не подтверждён — 409 `PANEL_USER_UNVERIFIED`, уже член — 409 `PANEL_ALREADY_MEMBER`.
 */
export const GrantRoleRequest = z.strictObject({
  email: Email,
  displayName: DisplayName,
  role: PanelRole,
});
export type GrantRoleRequest = z.infer<typeof GrantRoleRequest>;

/** `POST /v1/admin/members/:userId/role` — сменить роль, причина обязательна. */
export const ChangeRoleRequest = z.strictObject({ role: PanelRole, reason: ActionReason });
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequest>;

/** `POST /v1/admin/members/:userId/revoke` — снять роль (сессии панели сотрудника завершаются), причина обязательна. */
export const RevokeRoleRequest = z.strictObject({ reason: ActionReason });
export type RevokeRoleRequest = z.infer<typeof RevokeRoleRequest>;

/** Член команды для экрана «Сотрудники»; удалённый аккаунт — e-mail «Удалённый участник». */
export const PanelMember = z.object({
  userId: Uuid,
  displayName: z.string(),
  email: z.string(),
  role: PanelRole,
  status: MemberStatus,
  grantedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  /** 2FA подключена (ADR-0024): действие «Сбросить 2FA». */
  totpEnabled: z.boolean(),
});
export type PanelMember = z.infer<typeof PanelMember>;

/** Предел списка «Сотрудники» без пагинации (сервер и подпись «показаны первые N» в UI). */
export const PANEL_MEMBER_LIST_CAP = 500;

/** `GET /v1/admin/members` (`members.read`): до `PANEL_MEMBER_LIST_CAP` записей; `truncated` — есть ещё. */
export const PanelMemberList = z.object({ items: z.array(PanelMember), truncated: z.boolean() });
export type PanelMemberList = z.infer<typeof PanelMemberList>;
