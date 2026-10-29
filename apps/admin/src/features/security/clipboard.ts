/** Итог копирования в буфер: `failed` — API нет (не HTTPS, старый браузер) или браузер отказал. */
export type CopyState = 'idle' | 'copied' | 'failed';

/** Копирование текста в буфер обмена без исключений наружу: `true` — скопировано. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
