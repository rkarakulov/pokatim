import { zodResolver } from '@hookform/resolvers/zod';
import { RiderPublicName, type ProfileView } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, TextField, Toggle, textStyle, useTheme } from '@rkarakulov/ui';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { ModalSheet } from '@/components/modal-sheet';
import { actionErrorMessage, serverFieldErrors } from '@/features/auth/error-messages';

import { fieldText } from './profile-form';
import { useProfile, useUpdateProfile } from './queries';
import { nameConsentVisible } from './name-consent-state';
import { loadNameConsentSnooze, saveNameConsentSnooze } from './name-consent-storage';
import { closeNameConsent, showNameConsent, useNameConsentStore } from './name-consent-store';

/** Код ошибки «показ включён, а имени нет» (только шит; в профиле пустое имя с согласием допустимо, P1). */
const NAME_REQUIRED = 'NAME_REQUIRED';

/** Поля шита — схемы contracts (P2); показ без имени в шите бессмыслен — ошибка под полем (N4). */
const ConsentForm = z
  .object({ publicName: RiderPublicName, showNameInResults: z.boolean() })
  .superRefine((value, ctx) => {
    if (value.showNameInResults && value.publicName === null) {
      ctx.addIssue({ code: 'custom', path: ['publicName'], message: NAME_REQUIRED });
    }
  });
type ConsentFormValues = z.input<typeof ConsentForm>;
type ConsentFormOutput = z.output<typeof ConsentForm>;

const FIELDS = ['publicName', 'showNameInResults'] as const;

const errorText = (code: string | undefined) =>
  code === NAME_REQUIRED ? t('profile.consent.nameRequired') : fieldText(code);

/** Пауза N3 и снятие предложения: «Не сейчас», закрытие, сохранение без показа. */
function snooze() {
  void saveNameConsentSnooze(Date.now());
  closeNameConsent();
}

/**
 * Шит «Как вас показывать в результатах?» после новой заявки на гонку (name-consent-prompt, N1–N5): место —
 * «Ваше участие» карточки гонки. Показ — только для предложенной гонки (`offerNameConsent` из `useEnterRace`), когда
 * профиль известен, имени в таблицах ещё нет и пауза не действует (`nameConsentVisible`); иначе предложение снимается
 * без показа. Согласие — только «Сохранить» с включённым переключателем.
 */
export function NameConsentPrompt({ raceId }: { raceId: string }) {
  const offered = useNameConsentStore((state) => state.raceId === raceId);
  return offered ? <NameConsentGate /> : null;
}

function NameConsentGate() {
  const profile = useProfile();
  // `undefined` — хранилище ещё читается
  const [snoozedAt, setSnoozedAt] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadNameConsentSnooze().then((value) => {
      if (alive) setSnoozedAt(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  // решение — один раз (стор): сохранение меняет кэш профиля, открытый шит от этого не закрывается и не мигает
  const shown = useNameConsentStore((state) => state.shown);
  const data = profile.data;
  const failed = profile.isError && data === undefined;
  useEffect(() => {
    if (shown || snoozedAt === undefined) return;
    if (failed) {
      closeNameConsent();
      return;
    }
    if (data === undefined) return;
    if (nameConsentVisible({ profile: data, snoozedAt, now: Date.now() })) showNameConsent();
    else closeNameConsent();
  }, [shown, snoozedAt, data, failed]);

  return shown && data ? <NameConsentSheet profile={data} /> : null;
}

function NameConsentSheet({ profile }: { profile: ProfileView }) {
  const theme = useTheme();
  const update = useUpdateProfile();
  const [failure, setFailure] = useState<string>();
  const form = useForm<ConsentFormValues, unknown, ConsentFormOutput>({
    resolver: zodResolver(ConsentForm),
    mode: 'onTouched',
    // согласие предзаполнено «вкл» (N4); действует только по «Сохранить» (N5)
    defaultValues: { publicName: profile.publicName ?? '', showNameInResults: true },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(undefined);
    try {
      await update.mutateAsync(values);
      if (values.showNameInResults) closeNameConsent();
      else snooze();
    } catch (error) {
      const fields = serverFieldErrors(error, FIELDS);
      if (fields.length > 0) {
        for (const { field, code } of fields) {
          form.setError(field, { type: 'server', message: code });
        }
        return;
      }
      setFailure(actionErrorMessage(error));
    }
  });

  return (
    <ModalSheet title={t('profile.consent.title')} onClose={snooze} testID="name-consent-sheet">
      <View style={styles.form}>
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t('profile.consent.lead')}
        </Text>
        <Controller
          control={form.control}
          name="publicName"
          render={({ field }) => (
            <TextField
              label={t('profile.name.label')}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              helper={t('profile.name.hint')}
              autoComplete="off"
              error={errorText(errors.publicName?.message)}
            />
          )}
        />
        <View style={styles.stack}>
          <Controller
            control={form.control}
            name="showNameInResults"
            render={({ field }) => (
              <Toggle
                label={t('profile.show.label')}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  // выключили показ — ошибка «введите имя» больше не про это поле
                  if (!value) form.clearErrors('publicName');
                }}
              />
            )}
          />
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('profile.show.hint')}
          </Text>
          {errors.showNameInResults ? (
            <Text style={[textStyle('meta'), { color: theme.status.error }]}>
              {errorText(errors.showNameInResults.message)}
            </Text>
          ) : null}
        </View>
        <View style={styles.stack}>
          {failure ? <Banner tone="error" message={failure} /> : null}
          <Button
            label={t('profile.save')}
            onPress={() => void onSubmit()}
            loading={update.isPending}
          />
          <View style={styles.later}>
            <TextAction
              label={t('profile.consent.later')}
              onPress={snooze}
              disabled={update.isPending}
            />
          </View>
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s4 },
  stack: { gap: space.s2 },
  later: { alignItems: 'center' },
});
