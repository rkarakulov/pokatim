import { RecoveryCode, TotpCode } from '@pokatim/contracts';

/** Код из приложения: пробелы (группы «123 456») убираются до отправки; `undefined` — не 6 цифр. */
export function totpCodeOf(input: string): string | undefined {
  const parsed = TotpCode.safeParse(input.replace(/\s/g, ''));
  return parsed.success ? parsed.data : undefined;
}

/** Код восстановления: пробелы по краям и внутри убираются; формат — схема контракта. */
export function recoveryCodeOf(input: string): string | undefined {
  const parsed = RecoveryCode.safeParse(input.replace(/\s/g, ''));
  return parsed.success ? parsed.data : undefined;
}

/** Ключ для ручного ввода группами по 4 символа. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;
