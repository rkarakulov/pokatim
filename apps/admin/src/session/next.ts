/**
 * Путь возврата после входа (`next`): только путь внутри панели — начинается с одного `/`, без `//` и `\` (иначе
 * браузер уйдёт на чужой origin), без схемы и управляющих символов. Иначе — `undefined` (вход ведёт на «Обзор»).
 */
export function safeNext(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    // разбор относительно фиктивного origin: путь не должен менять origin
    const url = new URL(value, 'https://panel.invalid');
    if (url.origin !== 'https://panel.invalid') return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
