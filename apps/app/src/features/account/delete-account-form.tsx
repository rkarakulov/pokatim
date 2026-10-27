import { zodResolver } from '@hookform/resolvers/zod';
import { DeleteAccountRequest } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { Banner, Button, TextAction, TextField, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { DocumentTitle } from '@/components/document-title';
import { AuthActions, AuthScreen, AuthText } from '@/features/auth/auth-screen';
import {
  actionErrorMessage,
  apiErrorCode,
  fieldErrorMessage,
  retryAfterSec,
  serverFieldErrors,
} from '@/features/auth/error-messages';
import { formatCountdown, useSecondsLeft } from '@/lib/countdown';

import { useDeleteAccount } from './queries';

const DOCUMENT_TITLE = `${t('account.delete.title')} — ${t('app.name')}`;

/** Последствия удаления (A1, A3–A8) — статичный список. */
const CONSEQUENCES = [
  'account.delete.consequence.sessions',
  'account.delete.consequence.data',
  'account.delete.consequence.results',
  'account.delete.consequence.disputes',
  'account.delete.consequence.rides',
  'account.delete.consequence.devices',
  'account.delete.consequence.email',
] as const satisfies readonly MessageKey[];

const FIELDS = ['password'] as const;
/** Код ошибки поля «неверный пароль» (403) — рядом с кодами схемы. */
const PASSWORD_INCORRECT = 'PASSWORD_INCORRECT';

/** Момент через `sec` секунд (мс) — конец паузы 429. */
const momentIn = (sec: number) => Date.now() + sec * 1000;

const passwordErrorText = (code: string | undefined) =>
  code === PASSWORD_INCORRECT
    ? t('account.delete.errors.passwordIncorrect')
    : fieldErrorMessage(code);

/** Текст баннера отказа: ошибки поля и пауза 429 показываются не здесь. */
function bannerMessage(error: unknown): string | undefined {
  const code = apiErrorCode(error);
  if (code === PASSWORD_INCORRECT) return undefined;
  if (serverFieldErrors(error, FIELDS).length > 0) return undefined;
  if (retryAfterSec(error) !== undefined) return undefined;
  if (code === 'ACCOUNT_PANEL_MEMBER') return t('account.delete.errors.panelMember');
  return actionErrorMessage(error);
}

/**
 * «Удаление аккаунта» (A1–A12, экран 14): последствия, текущий пароль, «Удалить навсегда» (F7: `Button primary` —
 * «опасной» кнопки в `@rkarakulov/ui` пока нет; опасность передают текст, список и пароль). Неверный пароль — под
 * полем, сессия жива; член команды панели, сеть, сбой — баннер; 429 — баннер с отсчётом, кнопка выключена. Ошибки —
 * в живом регионе (RN-web — `aria-live`). Успех — выход (`useDeleteAccount`), экран уходит на «Регистрацию».
 */
export function DeleteAccountForm() {
  const theme = useTheme();
  const router = useRouter();
  const remove = useDeleteAccount();
  const [lockedUntil, setLockedUntil] = useState<number | undefined>();
  const lockedSec = useSecondsLeft(lockedUntil);
  const locked = lockedSec > 0;

  const {
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<DeleteAccountRequest>({
    resolver: zodResolver(DeleteAccountRequest),
    mode: 'onTouched',
    defaultValues: { password: '' },
  });
  const password = useWatch({ control, name: 'password' });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await remove.mutateAsync(values);
    } catch (error) {
      const wait = retryAfterSec(error);
      if (wait !== undefined) setLockedUntil(momentIn(wait));
      if (apiErrorCode(error) === PASSWORD_INCORRECT) {
        setError('password', { type: 'server', message: PASSWORD_INCORRECT });
      }
      for (const { field, code } of serverFieldErrors(error, FIELDS)) {
        setError(field, { type: 'server', message: code });
      }
    }
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings/profile'));

  const failure = remove.error === null ? undefined : bannerMessage(remove.error);

  return (
    <AuthScreen title={t('account.delete.title')} lead={t('account.delete.lead')}>
      <DocumentTitle title={DOCUMENT_TITLE} />
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('account.delete.consequencesTitle')}
      </Text>
      <View accessibilityRole="list" style={styles.list}>
        {CONSEQUENCES.map((key) => (
          <Text key={key} style={[textStyle('body'), { color: theme.text.primary }]}>
            {t(key)}
          </Text>
        ))}
      </View>
      <AuthText tone="secondary">{t('account.delete.passwordPrompt')}</AuthText>
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            label={t('account.delete.password')}
            value={field.value}
            onChangeText={(value) => {
              clearErrors('password');
              field.onChange(value);
            }}
            onBlur={field.onBlur}
            secureTextEntry
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect={false}
            error={passwordErrorText(errors.password?.message)}
          />
        )}
      />
      <AuthActions>
        <View
          testID="account-delete-errors"
          accessibilityLiveRegion="assertive"
          style={styles.errors}
        >
          {locked ? (
            <Banner
              tone="warning"
              message={t('account.delete.errors.rateLimited', {
                time: formatCountdown(lockedSec),
              })}
            />
          ) : null}
          {failure !== undefined ? <Banner tone="error" message={failure} /> : null}
        </View>
        <Button
          label={t('account.delete.submit')}
          onPress={() => void onSubmit()}
          disabled={password.length === 0 || locked}
          loading={remove.isPending}
        />
        <View style={styles.start}>
          <TextAction label={t('account.delete.back')} onPress={back} />
        </View>
      </AuthActions>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s2 },
  errors: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
