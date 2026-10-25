import { Uuid } from '@pokatim/contracts';
import { z } from 'zod';

import { domainError } from './error-messages';

/**
 * Непрозрачный курсор страницы списков по `(ключ сортировки, _id)`: base64url от JSON `{ k, id }`. Разбор — zod
 * (ключ — схема вызывающего, `id` — `Uuid`): в фильтр MongoDB попадают только примитивы. Мусор — 400
 * `VALIDATION_FAILED` на поле `cursor`. Общий для списков модулей (`races`, `calendar`), как `error-messages.ts`.
 */
export function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify({ k: key, id }), 'utf8').toString('base64url');
}

export function decodeCursor<K extends z.ZodType<string>>(
  raw: string,
  keySchema: K,
): { k: z.infer<K>; id: string } {
  const invalid = () =>
    domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });
  let json: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = z.strictObject({ k: keySchema, id: Uuid }).safeParse(json);
  if (!parsed.success) throw invalid();
  return parsed.data as { k: z.infer<K>; id: string };
}
