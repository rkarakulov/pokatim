import { z } from 'zod';

/**
 * Личный код приглашения райдера (K9, P6). Читается с картинки карточки и набирается руками: без похожих символов
 * `0 O 1 I L`, регистр при вводе не важен.
 */
export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 7;

export const InviteCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[2-9A-HJKMNP-Z]{7}$/);
export type InviteCode = z.infer<typeof InviteCode>;

/** `GET /v1/social/invite-code` — личный код вошедшего райдера (выдаётся при первом запросе). */
export const InviteCodeResponse = z.object({ code: InviteCode });
export type InviteCodeResponse = z.infer<typeof InviteCodeResponse>;
