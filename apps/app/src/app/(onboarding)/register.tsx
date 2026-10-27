import { zodResolver } from '@hookform/resolvers/zod';
import { MIN_AGE_YEARS, MIN_BIRTH_DATE, RegisterRequest, minskToday } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { Banner, Button, Checkbox, DateField, TextAction, TextField } from '@rkarakulov/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';
import { useCallback, useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';
import type { z } from 'zod';

import { DocumentTitle } from '@/components/document-title';
import {
  AuthActions,
  AuthInline,
  AuthMeta,
  AuthScreen,
  AuthText,
} from '@/features/auth/auth-screen';
import {
  actionErrorMessage,
  apiErrorCode,
  fieldErrorMessage,
  serverFieldErrors,
} from '@/features/auth/error-messages';
import { useRegister } from '@/features/auth/queries';
import { useRegistrationStore } from '@/features/auth/registration-store';
import { useSessionStore } from '@/features/auth/session-store';
import { publicPageMetadata } from '@/lib/page-metadata';

/** Значения формы до проверки: согласие может быть не отмечено, дата — не выбрана. */
type RegisterForm = z.input<typeof RegisterRequest>;

const FIELDS = ['email', 'password', 'birthDate', 'personalDataConsent'] as const;
/** Отказы по e-mail показываются у поля, остальные ошибки ответа — баннером над кнопкой. */
const EMAIL_REFUSALS = ['EMAIL_TAKEN', 'EMAIL_UNAVAILABLE'] as const;

const isEmailRefusal = (code: string | undefined): code is (typeof EMAIL_REFUSALS)[number] =>
  EMAIL_REFUSALS.some((refusal) => refusal === code);

/** Публичный экран (SSR web): мета и OG без данных формы. */
export const generateMetadata: GenerateMetadataFunction = () =>
  publicPageMetadata({ title: t('auth.kicker'), description: t('app.tagline'), path: '/register' });

/** Пикер пустой даты открывается на «ровно 18 лет назад», а не на сегодня. */
const adultSince = (today: string) =>
  `${Number(today.slice(0, 4)) - MIN_AGE_YEARS}${today.slice(4)}`;

export default function RegisterScreen() {
  const router = useRouter();
  const register = useRegister();
  const draft = useRegistrationStore((state) => state.draft);
  const resumeOnLaunch = useRegistrationStore((state) => state.resumeOnLaunch);
  const today = minskToday();
  // «Аккаунт удалён» (account-deletion): отметка выхода — до ухода с экрана
  const accountDeleted = useSessionStore((state) => state.notice === 'accountDeleted');

  const {
    control,
    handleSubmit,
    getValues,
    setError,
    setValue,
    formState: { errors },
  } = useForm<RegisterForm, unknown, RegisterRequest>({
    resolver: zodResolver(RegisterRequest),
    // проверка поля — при уходе с него, затем при каждом изменении
    mode: 'onTouched',
    defaultValues: {
      email: draft.email ?? '',
      password: '',
      birthDate: draft.birthDate,
      personalDataConsent: draft.personalDataConsent ? true : undefined,
    },
  });
  const consent = useWatch({ control, name: 'personalDataConsent' });
  const emailCode = errors.email?.message;

  // возврат к уже смонтированной форме (например, «Создать аккаунт» со входа): адрес мог смениться в черновике —
  // поле берёт его; defaultValues действуют только при первом монтировании
  useFocusEffect(
    useCallback(() => {
      const { email } = useRegistrationStore.getState().draft;
      if (email !== undefined && email !== getValues('email')) setValue('email', email);
    }, [getValues, setValue]),
  );

  // сообщение показано — при уходе с экрана снимается (одно объявление, без повтора при возврате)
  useFocusEffect(useCallback(() => () => useSessionStore.getState().clearNotice(), []));

  // приложение перезапущено, пока жив токен регистрации, — сразу к «Подтвердите e-mail»
  useEffect(() => {
    if (!resumeOnLaunch) return;
    useRegistrationStore.getState().consumeResume();
    router.push('/check-email');
  }, [resumeOnLaunch, router]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await register.mutateAsync(values);
      const store = useRegistrationStore.getState();
      store.saveDraft({
        email: values.email,
        birthDate: values.birthDate,
        personalDataConsent: true,
      });
      await store.start(response);
      // «Вернуться к регистрации» сохраняет форму, кроме пароля
      setValue('password', '');
      router.push('/check-email');
    } catch (error) {
      const code = apiErrorCode(error);
      if (isEmailRefusal(code)) setError('email', { type: 'server', message: code });
      for (const { field, code: fieldCode } of serverFieldErrors(error, FIELDS)) {
        setError(field, { type: 'server', message: fieldCode });
      }
    }
  });

  // e-mail для экрана входа — через память (черновик), не через URL
  const toSignIn = () => {
    const store = useRegistrationStore.getState();
    store.saveDraft({ ...store.draft, email: getValues('email') });
    router.push('/sign-in');
  };

  const failure = register.error;
  const failureCode = apiErrorCode(failure);
  const showBanner =
    failure !== null && !isEmailRefusal(failureCode) && failureCode !== 'VALIDATION_FAILED';
  const blocked = consent !== true || Object.keys(errors).length > 0;

  return (
    <AuthScreen title={t('auth.register.title')} lead={t('auth.register.lead')}>
      {/* заголовок вкладки после клиентской навигации (web); при SSR — из generateMetadata */}
      <DocumentTitle title={`${t('auth.kicker')} — ${t('app.name')}`} />
      {/* объявление результата удаления скринридеру (вежливо: экран только что сменился) */}
      {accountDeleted ? (
        <View accessibilityLiveRegion="polite">
          <Banner message={t('auth.register.accountDeleted')} />
        </View>
      ) : null}
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            label={t('auth.register.email')}
            placeholder={t('auth.register.emailPlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            error={fieldErrorMessage(emailCode)}
          />
        )}
      />
      {/* «Войти» — только у занятого адреса; у адреса удалённого аккаунта — нейтральный отказ (D-07) */}
      {emailCode === 'EMAIL_TAKEN' ? (
        <TextAction label={t('auth.signIn.action')} onPress={toSignIn} />
      ) : null}
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            label={t('auth.register.password')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            secureTextEntry
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            error={fieldErrorMessage(errors.password?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="birthDate"
        render={({ field }) => (
          <DateField
            label={t('auth.register.birthDate')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            minimumDate={MIN_BIRTH_DATE}
            maximumDate={today}
            initialPickerDate={adultSince(today)}
            helper={t('auth.register.birthDateHelper')}
            error={fieldErrorMessage(errors.birthDate?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="personalDataConsent"
        render={({ field }) => (
          <Checkbox
            label={t('auth.register.consent')}
            checked={field.value === true}
            onChange={field.onChange}
          />
        )}
      />
      <AuthText tone="secondary">{t('auth.register.agreement')}</AuthText>
      <AuthActions>
        {showBanner ? <Banner tone="error" message={actionErrorMessage(failure)} /> : null}
        <Button
          label={t('auth.register.submit')}
          onPress={() => void onSubmit()}
          disabled={blocked}
          loading={register.isPending}
        />
        <AuthInline>
          <AuthMeta>{t('auth.register.haveAccount')}</AuthMeta>
          <TextAction label={t('auth.signIn.action')} onPress={toSignIn} />
        </AuthInline>
      </AuthActions>
    </AuthScreen>
  );
}
