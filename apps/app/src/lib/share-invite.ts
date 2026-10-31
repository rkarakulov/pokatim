/**
 * Личный код приглашения в ссылках «Поделиться» (P6, K9): модульное значение — `navigator.share` вызывается синхронно,
 * до любого `await`, поэтому код должен быть под рукой без запроса. Ставит `InviteShareSync` (код вошедшего), гость и
 * выход — `null`: ссылка без параметра.
 */
let shareInvite: string | null = null;

export function setShareInvite(code: string | null): void {
  shareInvite = code;
}

/** Путь ссылки с `invite=<код>` (через `?` или `&`); кода нет — путь как есть. */
export function withInvite(path: string): string {
  if (!shareInvite) return path;
  return `${path}${path.includes('?') ? '&' : '?'}invite=${encodeURIComponent(shareInvite)}`;
}
