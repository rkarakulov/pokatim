import Constants from 'expo-constants';

/** Версия приложения из конфигурации сборки (`app.json` → `expo.version`); нет — строки версии нет. */
export function appVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

export interface AboutLinks {
  privacy: string | null;
  terms: string | null;
  /** адрес поддержки (показывается в строке), открывается письмом `mailto:` */
  supportEmail: string | null;
}

/**
 * Ссылки «О приложении» — публичные значения сборки `EXPO_PUBLIC_*` (Metro подставляет только прямое обращение к
 * `process.env.EXPO_PUBLIC_…`). Не задано или не https / не похоже на адрес — строки нет.
 */
export function aboutLinks(): AboutLinks {
  return {
    privacy: httpsUrl(process.env.EXPO_PUBLIC_PRIVACY_URL),
    terms: httpsUrl(process.env.EXPO_PUBLIC_TERMS_URL),
    supportEmail: email(process.env.EXPO_PUBLIC_SUPPORT_EMAIL),
  };
}

function httpsUrl(value: string | undefined): string | null {
  return value && /^https:\/\/\S+$/.test(value) ? value : null;
}

function email(value: string | undefined): string | null {
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
